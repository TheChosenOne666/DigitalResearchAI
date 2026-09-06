import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { getTenantContext } from '../../common/auth/tenant-context';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import {
  detectMimeType,
  DocParserService,
  type DocMimeType,
} from './parse/doc-parser.service';
import { KbLearningService, type LearnDocumentPayload } from './learning/learning.service';
import { KbStoreService } from './store/kb.store.service';
import { KbLearningStoreService } from './store/kb-learning.store.service';
import { buildSourceDocument, type SourceDocInput } from './save/source-doc';
import { createLearnQueue, submitLearnJob } from './queue/learn-queue';

/** 数据库存储原文件的最大字节（超出后端不落盘，仅解析学习） */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * 知识库业务编排服务（M3.2）：文档上传/重新学习/配置更新。
 * 上传：创建文档 → 入 chunk-embed 队列；队列不可用时降级同步学习。
 * 全部经租户上下文，重新学习/上传的后续学习由 worker 用系统 client + 显式 tenant_id 完成。
 */
@Injectable()
export class KbService {
  private readonly logger = new Logger(KbService.name);
  /** 学习队列懒初始化（首次提交时创建；bullmq 不可用为 null，降级同步学习） */
  private queuePromise: Promise<Queue | null> | null = null;

  constructor(
    private readonly store: KbStoreService,
    private readonly learningStore: KbLearningStoreService,
    private readonly parser: DocParserService,
    private readonly learning: KbLearningService,
    private readonly config: ConfigService,
  ) {}

  /** 获取（或首次创建）学习队列实例 */
  private getQueue(): Promise<Queue | null> {
    if (!this.queuePromise) this.queuePromise = createLearnQueue(this.config);
    return this.queuePromise;
  }

  /** 当前请求租户上下文（受保护路由注入） */
  private requireTenant(): { tenantId: string; userId: string } {
    const ctx = getTenantContext();
    if (!ctx) {
      throw new BizException(ErrorCode.UNAUTHORIZED, '缺少租户上下文', HttpStatus.UNAUTHORIZED);
    }
    return { tenantId: ctx.tenantId, userId: ctx.userId };
  }

  /**
   * 上传文档并触发学习。
   * @param libraryId 目标库
   * @param groupId 分组（可空）
   * @param filename 原文件名
   * @param buffer 文件字节
   * @returns 文档 id 与当前状态
   */
  async uploadDocument(
    libraryId: string,
    groupId: string | null,
    filename: string,
    buffer: Buffer,
  ): Promise<{ id: string; status: string }> {
    const { tenantId } = this.requireTenant();
    const mimeType = detectMimeType(filename);
    if (buffer.byteLength === 0) {
      throw new BizException(ErrorCode.VALIDATION_FAILED, '文件内容为空', HttpStatus.BAD_REQUEST);
    }
    if (buffer.byteLength > MAX_UPLOAD_BYTES) {
      throw new BizException(ErrorCode.VALIDATION_FAILED, '文件超过 50MB 限制', HttpStatus.BAD_REQUEST);
    }
    const doc = await this.store.createDocument({
      tenantId,
      libraryId,
      groupId,
      name: filename,
      mimeType,
      size: buffer.byteLength,
      buffer,
    });
    const payload: LearnDocumentPayload = {
      tenantId,
      documentId: doc.id,
      mimeType,
      bufferBase64: buffer.toString('base64'),
    };
    const submitted = await this.submitLearn(payload);
    return { id: doc.id, status: submitted ? 'LEARNING' : 'FAILED' };
  }

  /** 重新/继续学习（文档状态机：FAILED/INTERRUPTED/LEARNING → 重跑） */
  async relearn(
    libraryId: string,
    documentId: string,
  ): Promise<{ id: string; status: string }> {
    const { tenantId } = this.requireTenant();
    const detail = await this.store.getDocument(documentId);
    if (!detail || detail.libraryId !== libraryId) {
      throw new BizException(ErrorCode.NOT_FOUND, '文档不存在', HttpStatus.NOT_FOUND);
    }
    const payload: LearnDocumentPayload = {
      tenantId,
      documentId,
      mimeType: detail.mimeType as DocMimeType,
    };
    const submitted = await this.submitLearn(payload);
    return { id: documentId, status: submitted ? 'LEARNING' : 'FAILED' };
  }

  /** 提交学习任务：入队（jobId 幂等去重）或降级同步执行。返回是否成功提交 */
  private async submitLearn(payload: LearnDocumentPayload): Promise<boolean> {
    const queue = await this.getQueue();
    if (queue) {
      try {
        return await submitLearnJob(queue, payload);
      } catch (e) {
        this.logger.warn(`入队失败，降级同步学习：${(e as Error).message}`);
      }
    }
    // 降级：同步学习（worker 不可用时）
    try {
      await this.learning.learn(payload);
      return true;
    } catch (e) {
      await this.learning.markFailed(payload.tenantId, payload.documentId, (e as Error).message);
      return false;
    }
  }

  // ===== 存入与审核链路（M3.4）=====

  /**
   * 智搜勾选来源存入知识库：每条来源独立生成一份 Markdown 文档落库，
   * 状态停留 PENDING（待审核）；审核通过后由审核接口触发自动学习。
   * @returns 创建的文档 id 与文档名列表
   */
  async saveSourcesToLibrary(params: {
    libraryId: string;
    groupId: string | null;
    visibility: string;
    tags: string[];
    sessionId: string;
    question?: string | null;
    sources: SourceDocInput[];
  }): Promise<{ created: number; documents: Array<{ id: string; name: string }> }> {
    const { tenantId } = this.requireTenant();
    const lib = await this.store.getLibrary(params.libraryId);
    if (!lib) {
      throw new BizException(ErrorCode.NOT_FOUND, '目标知识库不存在', HttpStatus.NOT_FOUND);
    }
    if (params.groupId) {
      const groups = await this.store.listGroups(params.libraryId);
      if (!groups.some((g) => g.id === params.groupId)) {
        throw new BizException(ErrorCode.VALIDATION_FAILED, '分组不存在或不属于该知识库', HttpStatus.BAD_REQUEST);
      }
    }
    const visibility = params.visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE';
    const documents: Array<{ id: string; name: string }> = [];
    for (const src of params.sources) {
      const doc = buildSourceDocument(src, {
        sessionId: params.sessionId,
        question: params.question ?? null,
      });
      const created = await this.store.createDocument({
        tenantId,
        libraryId: params.libraryId,
        groupId: params.groupId,
        name: doc.name,
        mimeType: 'md',
        size: Buffer.byteLength(doc.content, 'utf8'),
        buffer: Buffer.from(doc.content, 'utf8'),
        visibility,
        tags: params.tags,
        sourceSessionId: params.sessionId,
      });
      documents.push({ id: created.id, name: doc.name });
      this.logger.log(`来源已提交审核入库：doc=${created.id} lib=${params.libraryId} src=${src.title.slice(0, 40)}`);
    }
    return { created: documents.length, documents };
  }

  /** 审核通过：待审核文档进入学习队列（BullMQ），失败降级同步学习 */
  async approveReview(documentId: string): Promise<{ id: string; status: string }> {
    const { tenantId } = this.requireTenant();
    const detail = await this.store.getDocument(documentId);
    if (!detail) {
      throw new BizException(ErrorCode.NOT_FOUND, '文档不存在', HttpStatus.NOT_FOUND);
    }
    if (detail.status !== 'PENDING') {
      throw new BizException(ErrorCode.VALIDATION_FAILED, '该文档不在待审核状态', HttpStatus.BAD_REQUEST);
    }
    const buffer = await this.learningStore.getDocumentFile(tenantId, documentId);
    if (!buffer || buffer.byteLength === 0) {
      await this.learning.markFailed(tenantId, documentId, '原始内容缺失');
      throw new BizException(ErrorCode.VALIDATION_FAILED, '原始内容缺失，无法学习', HttpStatus.BAD_REQUEST);
    }
    const payload: LearnDocumentPayload = {
      tenantId,
      documentId,
      mimeType: detail.mimeType as DocMimeType,
    };
    const submitted = await this.submitLearn(payload);
    this.logger.log(`审核通过触发学习：doc=${documentId} status=${submitted ? 'LEARNING' : 'FAILED'}`);
    return { id: documentId, status: submitted ? 'LEARNING' : 'FAILED' };
  }

  /** 审核拒绝：删除待审核文档（仅来源文本副本，不入库不留文件） */
  async rejectReview(documentId: string): Promise<{ id: string; rejected: boolean }> {
    await this.requireTenant();
    const detail = await this.store.getDocument(documentId);
    if (!detail) {
      throw new BizException(ErrorCode.NOT_FOUND, '文档不存在', HttpStatus.NOT_FOUND);
    }
    if (detail.status !== 'PENDING') {
      throw new BizException(ErrorCode.VALIDATION_FAILED, '该文档不在待审核状态', HttpStatus.BAD_REQUEST);
    }
    await this.store.deleteDocument(documentId);
    this.logger.log(`审核拒绝并移除文档：doc=${documentId}`);
    return { id: documentId, rejected: true };
  }
}