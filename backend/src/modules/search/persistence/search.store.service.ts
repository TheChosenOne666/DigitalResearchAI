import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { getTenantContext } from '../../../common/auth/tenant-context';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { BizException } from '../../../common/exceptions/biz.exception';
import { Prisma } from '../../../generated/prisma/client';
import { ErrorCode } from '@app/shared';
import type { SearchConditions, SearchHit } from '../connectors/connector.interface';

/** 会话列表项（历史接口返回） */
export interface SessionListItem {
  id: string;
  question: string;
  mode: string;
  conditions: SearchConditions | null;
  createdAt: Date;
  /** 最新报告（If存在） */
  reportId?: string;
  reportCreatedAt?: Date;
}

/** 报告详情（含来源卡） */
export interface ReportDetail {
  id: string;
  contentMd: string;
  paramsSnapshot: unknown;
  tokenUsage: number;
  createdAt: Date;
  sources: Array<{
    idx: number;
    title: string;
    url: string | null;
    snippet: string;
    sourceType: string;
    isCited: boolean;
    meta: unknown;
  }>;
}

/** 报告落库输入（含来源卡列表） */
export interface ReportInput {
  contentMd: string;
  paramsSnapshot: Record<string, unknown>;
  tokenUsage: number;
  sources: Array<{ hit: SearchHit; idx: number; isCited: boolean }>;
}

/**
 * 智搜持久化服务（M2.3）：会话/报告/来源/用量落库。
 * 全部经 `PrismaService.forTenant`（租户 Extension 自动注入 tenant_id），
 * 报告/来源无独立租户列，统一通过所属 session 的嵌套写保证行级隔离。
 */
@Injectable()
export class SearchStoreService {
  private readonly logger = new Logger(SearchStoreService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 当前请求租户上下文（受保护路由由拦截器注入；缺失视为未授权） */
  private requireTenant(): { tenantId: string; userId: string } {
    const ctx = getTenantContext();
    if (!ctx) {
      throw new BizException(ErrorCode.UNAUTHORIZED, '缺少租户上下文', HttpStatus.UNAUTHORIZED);
    }
    return { tenantId: ctx.tenantId, userId: ctx.userId };
  }

  /** 创建会话（tenant_id 由租户 Extension 注入），返回会话 id */
  async createSession(
    userId: string,
    question: string,
    mode: string,
    conditions: SearchConditions,
  ): Promise<{ id: string }> {
    const { tenantId } = this.requireTenant();
    const session = await this.prisma.forTenant.searchSession.create({
      data: { tenantId, userId, question, mode, conditions: conditions as object },
    });
    return { id: session.id };
  }

  /** 条件回填后更新会话（conditions 快照） */
  async updateSessionConditions(sessionId: string, conditions: SearchConditions): Promise<void> {
    await this.prisma.forTenant.searchSession.update({
      where: { id: sessionId },
      data: { conditions: conditions as object },
    });
  }

  /**
   * 落报告 + 来源（嵌套写，隔离随 session；跨租户通过 where 注入的 tenant_id 拒绝）。
   * @returns 报告 id
   */
  async saveReport(sessionId: string, input: ReportInput): Promise<{ id: string }> {
    const session = (await this.prisma.forTenant.searchSession.update({
      where: { id: sessionId },
      data: {
        reports: {
          create: {
            contentMd: input.contentMd,
            paramsSnapshot: input.paramsSnapshot as object,
            tokenUsage: input.tokenUsage,
            sources: {
              create: input.sources.map(({ hit, idx, isCited }) => ({
                idx,
                title: hit.title,
                url: hit.url ?? null,
                snippet: hit.snippet,
                sourceType: hit.sourceType,
                isCited,
                meta: hit.meta ? (hit.meta as Prisma.InputJsonValue) : Prisma.JsonNull,
              })),
            },
          },
        },
      },
      include: { reports: { orderBy: { createdAt: 'desc' }, take: 1 } },
    })) as unknown as { reports: Array<{ id: string }> };
    const report = session.reports[0];
    if (!report) {
      throw new BizException(ErrorCode.INTERNAL_ERROR, '报告落库失败', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    return { id: report.id };
  }

  /**
   * 搜索词统计落库（A-10 数据来源）：upsert search_terms（平台级公共表，走系统 client）。
   * totalCount 每次检索 +1；emptyCount 当本次检索返回结果为 0 时 +1。
   * @param term 搜索词
   * @param empty 本次检索结果是否为空
   */
  async trackSearchTerm(term: string, empty: boolean): Promise<void> {
    const t = term.trim();
    if (!t) return;
    try {
      await this.prisma.searchTerm.upsert({
        where: { term: t },
        create: {
          term: t,
          totalCount: 1,
          emptyCount: empty ? 1 : 0,
          lastSearchedAt: new Date(),
        },
        update: {
          totalCount: { increment: 1 },
          emptyCount: { increment: empty ? 1 : 0 },
          lastSearchedAt: new Date(),
        },
      });
    } catch (e) {
      this.logger.warn(`搜索词统计落库失败：${(e as Error).message}`);
    }
  }

  /**
   * 敏感词前置拦截（D8）：命中任一启用敏感词时累加命中次数、落审计并返回命中的词。
   * 未命中返回 null；拦截由调用方（search.controller）抛异常阻断该次检索。
   */
  async checkSensitiveWord(question: string): Promise<string | null> {
    const q = question.trim();
    if (!q) return null;
    const words = await this.prisma.sensitiveWord.findMany({ where: { enabled: true } });
    const hit = words.find((w) => q.toLowerCase().includes(w.word.toLowerCase()));
    if (!hit) return null;

    const ctx = getTenantContext();
    await Promise.allSettled([
      this.prisma.sensitiveWord.update({
        where: { id: hit.id },
        data: { hitCount: { increment: 1 } },
      }),
      this.prisma.auditLog.create({
        data: {
          tenantId: ctx?.tenantId ?? null,
          userId: ctx?.userId ?? null,
          action: 'SEARCH_BLOCKED',
          targetType: 'SENSITIVE_WORD',
          targetId: hit.id,
          detail: { word: hit.word, question: q },
        },
      }),
    ]);
    this.logger.warn(`敏感词命中拦截: word=${hit.word} userId=${ctx?.userId ?? '-'}`);
    return hit.word;
  }

  /** 用量计数：按天累加（searchCount+1，tokenUsage 累加）。无租户上下文时跳过，不阻断主流程 */
  async upsertUsage(userId: string, tokenUsage: number): Promise<void> {
    const ctx = getTenantContext();
    if (!ctx) {
      this.logger.warn('缺少租户上下文，跳过用量计数');
      return;
    }
    const day = new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()));
    // 用量按 (tenantId,userId,day) 复合唯一；走系统 client（显式 tenantId 隔离，避开租户 Extension 对 upsert where 的注入）
    await this.prisma.searchUsage.upsert({
      where: { tenantId_userId_day: { tenantId: ctx.tenantId, userId, day } },
      create: {
        tenantId: ctx.tenantId,
        userId,
        day,
        searchCount: 1,
        tokenUsage,
      },
      update: {
        searchCount: { increment: 1 },
        tokenUsage: { increment: tokenUsage },
      },
    });
  }

  /** 历史会话列表（按用户，最新在前，分页） */
  async listSessions(userId: string, page: number, pageSize: number): Promise<SessionListItem[]> {
    const skip = Math.max(0, (page - 1) * pageSize);
    const sessions = await this.prisma.forTenant.searchSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      include: { reports: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return sessions.map((s) => {
      const latest = s.reports[0];
      return {
        id: s.id,
        question: s.question,
        mode: s.mode,
        conditions: s.conditions as SearchConditions | null,
        createdAt: s.createdAt,
        reportId: latest?.id,
        reportCreatedAt: latest?.createdAt,
      };
    });
  }

  /** 报告详情（含来源卡；跨租户访问返回 404） */
  async reportDetail(sessionId: string): Promise<ReportDetail> {
    const session = await this.prisma.forTenant.searchSession.findFirst({
      where: { id: sessionId },
      include: {
        reports: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { sources: { orderBy: { idx: 'asc' } } },
        },
      },
    });
    const report = session?.reports[0];
    if (!session || !report) {
      throw new BizException(ErrorCode.NOT_FOUND, '报告不存在', HttpStatus.NOT_FOUND);
    }
    return {
      id: report.id,
      contentMd: report.contentMd,
      paramsSnapshot: report.paramsSnapshot,
      tokenUsage: report.tokenUsage,
      createdAt: report.createdAt,
      sources: report.sources.map((src) => ({
        idx: src.idx,
        title: src.title,
        url: src.url,
        snippet: src.snippet,
        sourceType: src.sourceType,
        isCited: src.isCited,
        meta: src.meta,
      })),
    };
  }
}