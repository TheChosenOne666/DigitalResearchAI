import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { Queue } from 'bullmq';

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
  private queue: Queue | null = null;

  constructor(
    private readonly store: KbStoreService,
    private readonly parser: DocParserService,
    private readonly learning: KbLearningService,
    config: ConfigService,
  ) {
    // 懒初始化队列（bullmq 未安装则跳过，依赖注入不失败）
    try {
      const url = config.get<string>('REDIS_URL', 'redis://localhost:6380')!;
      const u = new URL(url);
      this.queue = new Queue('chunk-embed', {
        connection: { host: u.hostname, port: Number(u.port || 6379), password: u.password || undefined },
      });
    } catch (e) {
      this.logger.warn(`BullMQ 不可用（${(e as Error).message}），上传将同步学习`);
      this.queue = null;
    }
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

  /** 提交学习任务：入队或降级同步执行。返回是否成功提交 */
  private async submitLearn(payload: LearnDocumentPayload): Promise<boolean> {
    if (this.queue) {
      try {
        await this.queue.add('learn', payload, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
        return true;
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
}