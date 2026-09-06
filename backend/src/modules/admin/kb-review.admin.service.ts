import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import { Prisma } from '../../generated/prisma/client';
import { KbLearningService, type LearnDocumentPayload } from '../kb/learning/learning.service';
import { createLearnQueue, submitLearnJob } from '../kb/queue/learn-queue';
import { parsePageParams, buildPageResult } from './pagination';

/** 允许入库的格式白名单（A-16 格式校验） */
const ALLOWED_MIME_TYPES = ['md', 'txt', 'pdf', 'docx', 'csv', 'xlsx', 'pptx'];

/** 校验项形状（重复性/完整性/合规性/格式） */
export interface ReviewCheck {
  status: 'PASS' | 'WARN' | 'FAIL';
  note: string;
}

/** 审核队列行（对外形状） */
export interface AdminKbReviewRow {
  id: string;
  tenantId: string;
  tenantName: string | null;
  libraryId: string;
  libraryName: string | null;
  groupId: string | null;
  groupName: string | null;
  name: string;
  mimeType: string;
  size: number;
  visibility: string;
  tags: string[];
  sourceSessionId: string | null;
  sourceType: string;
  submitter: string | null;
  createdAt: Date;
  checks: { duplicate: ReviewCheck; complete: ReviewCheck; compliance: ReviewCheck; format: ReviewCheck };
}

/**
 * 知识审核管理服务（A-16）：跨租户待审核列表 + 通过/驳回 + 来源溯源。
 * D1/D3：跨租户走 PrismaService 本体（系统 client）；审核通过触发学习（入队优先，失败降级同步），
 * 学习队列复用 KbLearningService 与共享 learn-queue 工厂（jobId 幂等 + 死信）。
 */
@Injectable()
export class KbReviewAdminService {
  private readonly logger = new Logger(KbReviewAdminService.name);
  /** 学习队列懒初始化（与 KbService 同款；bullmq/Redis 不可用则降级同步学习） */
  private queuePromise: Promise<Queue | null> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly learning: KbLearningService,
    private readonly config: ConfigService,
  ) {}

  /** 获取（或首次创建）学习队列实例 */
  private getQueue(): Promise<Queue | null> {
    if (!this.queuePromise) this.queuePromise = createLearnQueue(this.config);
    return this.queuePromise;
  }

  /** 跨租户待审核列表（含四项校验结果 + 分页） */
  async listReviews(query: { keyword?: string; page: number; pageSize: number }) {
    const where: Prisma.KbDocumentWhereInput = { status: 'PENDING' };
    const keyword = query.keyword?.trim();
    if (keyword) {
      where.name = { contains: keyword };
    }
    const params = parsePageParams(String(query.page), String(query.pageSize));
    const [total, docs] = await Promise.all([
      this.prisma.kbDocument.count({ where }),
      this.prisma.kbDocument.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: params.skip,
        take: params.take,
        select: {
          id: true, tenantId: true, libraryId: true, groupId: true, name: true,
          mimeType: true, size: true, visibility: true, tags: true,
          sourceSessionId: true, createdAt: true,
        },
      }),
    ]);

    const [tenantNames, libraries, groups, sessions, sensitiveWords, sameNameRows] = await Promise.all([
      this.loadTenantNames([...new Set(docs.map((d) => d.tenantId))]),
      docs.length
        ? this.prisma.kbLibrary.findMany({
            where: { id: { in: [...new Set(docs.map((d) => d.libraryId))] } },
            select: { id: true, name: true },
          })
        : [],
      docs.some((d) => d.groupId)
        ? this.prisma.kbGroup.findMany({
            where: { id: { in: docs.map((d) => d.groupId).filter((v): v is string => Boolean(v)) } },
            select: { id: true, name: true },
          })
        : [],
      docs.some((d) => d.sourceSessionId)
        ? this.prisma.searchSession.findMany({
            where: { id: { in: docs.map((d) => d.sourceSessionId).filter((v): v is string => Boolean(v)) } },
            select: { id: true, userId: true },
          })
        : [],
      this.prisma.sensitiveWord.findMany({ where: { enabled: true }, select: { word: true } }),
      docs.length
        ? this.prisma.kbDocument.findMany({
            where: {
              libraryId: { in: [...new Set(docs.map((d) => d.libraryId))] },
              name: { in: docs.map((d) => d.name) },
              id: { notIn: docs.map((d) => d.id) },
            },
            select: { libraryId: true, name: true },
          })
        : [],
    ]);

    const submitterIds = [...new Set(sessions.map((s) => s.userId))];
    const users = submitterIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: submitterIds } },
          select: { id: true, username: true, realName: true, nickname: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u.realName || u.nickname || u.username]));
    const sessionUser = new Map(sessions.map((s) => [s.id, s.userId]));
    const sameName = new Set(sameNameRows.map((r) => `${r.libraryId}:${r.name}`));
    const sensitiveList = sensitiveWords.map((w) => w.word.toLowerCase());

    const list = docs.map((d) => {
      const sourceType = d.sourceSessionId ? '检索成果入库' : '手动上传';
      const submitter = d.sourceSessionId ? (userMap.get(sessionUser.get(d.sourceSessionId) ?? '') ?? null) : null;
      return {
        id: d.id,
        tenantId: d.tenantId,
        tenantName: tenantNames.get(d.tenantId) ?? null,
        libraryId: d.libraryId,
        libraryName: libraries.find((l) => l.id === d.libraryId)?.name ?? null,
        groupId: d.groupId,
        groupName: groups.find((g) => g.id === d.groupId)?.name ?? null,
        name: d.name,
        mimeType: d.mimeType,
        size: d.size,
        visibility: d.visibility,
        tags: Array.isArray(d.tags) ? (d.tags as string[]) : [],
        sourceSessionId: d.sourceSessionId,
        sourceType,
        submitter,
        createdAt: d.createdAt,
        checks: {
          duplicate: sameName.has(`${d.libraryId}:${d.name}`)
            ? { status: 'WARN' as const, note: '库内存在同名条目，疑似重复' }
            : { status: 'PASS' as const, note: '通过' },
          complete:
            d.size <= 0
              ? { status: 'FAIL' as const, note: '内容为空' }
              : d.sourceSessionId
                ? { status: 'PASS' as const, note: '通过' }
                : { status: 'WARN' as const, note: '缺少引用来源字段' },
          compliance: sensitiveList.some((w) => d.name.toLowerCase().includes(w))
            ? { status: 'FAIL' as const, note: '标题命中敏感词' }
            : { status: 'PASS' as const, note: '通过' },
          format: ALLOWED_MIME_TYPES.includes(d.mimeType)
            ? { status: 'PASS' as const, note: '通过' }
            : { status: 'WARN' as const, note: `格式 ${d.mimeType} 不在常规白名单` },
        },
      };
    });
    return buildPageResult(list satisfies AdminKbReviewRow[], total, params);
  }

  /** 审核通过：原始内容校验后触发学习（入队优先，失败降级同步学习） */
  async approveReview(id: string) {
    const doc = await this.prisma.kbDocument.findUnique({
      where: { id },
      select: { id: true, tenantId: true, mimeType: true, status: true, fileData: true },
    });
    if (!doc) {
      throw new BizException(ErrorCode.NOT_FOUND, '文档不存在', HttpStatus.NOT_FOUND);
    }
    if (doc.status !== 'PENDING') {
      throw new BizException(ErrorCode.VALIDATION_FAILED, '该文档不在待审核状态', HttpStatus.BAD_REQUEST);
    }
    if (!doc.fileData || doc.fileData.byteLength === 0) {
      await this.learning.markFailed(doc.tenantId, doc.id, '原始内容缺失');
      throw new BizException(ErrorCode.VALIDATION_FAILED, '原始内容缺失，无法学习', HttpStatus.BAD_REQUEST);
    }
    const payload: LearnDocumentPayload = {
      tenantId: doc.tenantId,
      documentId: doc.id,
      mimeType: doc.mimeType as LearnDocumentPayload['mimeType'],
    };
    let status = 'FAILED';
    const queue = await this.getQueue();
    if (queue) {
      try {
        status = (await submitLearnJob(queue, payload)) ? 'LEARNING' : 'FAILED';
      } catch (e) {
        this.logger.warn(`入队失败，降级同步学习：${(e as Error).message}`);
      }
    }
    if (status === 'FAILED') {
      try {
        await this.learning.learn(payload);
        status = 'LEARNING';
      } catch (e) {
        await this.learning.markFailed(payload.tenantId, payload.documentId, (e as Error).message);
      }
    }
    this.logger.log(`管理端审核通过触发学习：doc=${doc.id} status=${status}`);
    return { id: doc.id, status };
  }

  /** 审核驳回：删除待审核文档（PENDING 无切片/向量，直接级联删除），原因必填 */
  async rejectReview(id: string, reason: string) {
    const doc = await this.prisma.kbDocument.findUnique({
      where: { id },
      select: { id: true, status: true, name: true },
    });
    if (!doc) {
      throw new BizException(ErrorCode.NOT_FOUND, '文档不存在', HttpStatus.NOT_FOUND);
    }
    if (doc.status !== 'PENDING') {
      throw new BizException(ErrorCode.VALIDATION_FAILED, '该文档不在待审核状态', HttpStatus.BAD_REQUEST);
    }
    await this.prisma.kbDocument.delete({ where: { id } });
    this.logger.log(`管理端审核驳回并移除文档：doc=${id} reason=${reason}`);
    return { id, rejected: true, reason };
  }

  /** 来源溯源：入库来源/所属库与分组/提交人/检索问题 */
  async trace(id: string) {
    const doc = await this.prisma.kbDocument.findUnique({
      where: { id },
      select: {
        id: true, tenantId: true, libraryId: true, groupId: true, name: true, mimeType: true,
        size: true, status: true, visibility: true, tags: true, sourceSessionId: true, createdAt: true,
      },
    });
    if (!doc) {
      throw new BizException(ErrorCode.NOT_FOUND, '文档不存在', HttpStatus.NOT_FOUND);
    }
    const [tenant, library, group, session] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: doc.tenantId }, select: { name: true } }),
      this.prisma.kbLibrary.findUnique({ where: { id: doc.libraryId }, select: { name: true } }),
      doc.groupId
        ? this.prisma.kbGroup.findUnique({ where: { id: doc.groupId }, select: { name: true } })
        : null,
      doc.sourceSessionId
        ? this.prisma.searchSession.findUnique({
            where: { id: doc.sourceSessionId },
            select: { id: true, question: true, userId: true },
          })
        : null,
    ]);
    const submitter = session
      ? await this.prisma.user.findUnique({
          where: { id: session.userId },
          select: { id: true, username: true, realName: true, nickname: true },
        })
      : null;
    return {
      id: doc.id,
      name: doc.name,
      status: doc.status,
      sourceType: doc.sourceSessionId ? '检索成果入库（U-11）' : '手动上传',
      tenantName: tenant?.name ?? null,
      libraryName: library?.name ?? null,
      groupName: group?.name ?? null,
      sourceQuestion: session?.question ?? null,
      sourceLink: null as string | null,
      submitter: submitter
        ? { id: submitter.id, name: submitter.realName || submitter.nickname || submitter.username }
        : null,
      tags: Array.isArray(doc.tags) ? (doc.tags as string[]) : [],
      createdAt: doc.createdAt,
    };
  }

  /** 批量加载租户名（跨租户归属展示） */
  private async loadTenantNames(tenantIds: string[]): Promise<Map<string, string>> {
    if (!tenantIds.length) return new Map();
    const rows = await this.prisma.tenant.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
