import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { getTenantContext } from '../../../common/auth/tenant-context';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { BizException } from '../../../common/exceptions/biz.exception';
import { Prisma } from '../../../generated/prisma/client';
import { ErrorCode } from '@app/shared';
import type { RetrievalSourceItem } from '@app/shared';
import type { SearchConditions, SearchHit } from '../connectors/connector.interface';
import { RETRIEVAL_TTL_SECONDS } from '../search.constants';

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
  /** 17 两段式：pending_selection=有检索快照待选择 / done=已出报告（旧会话无快照也归 done） */
  status: 'pending_selection' | 'done';
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

/** 已完成章节（18 批 4 断点续跑载体） */
export interface ReportSegmentRow {
  idx: number;
  heading: string;
  contentMd: string;
}

/** 报告草稿（含已完成章节） */
export interface DraftReport {
  id: string;
  /** 断点位置：下一章从该序号继续 */
  segmentIdx: number;
  segments: ReportSegmentRow[];
  /** 生成参数快照（续跑时沿用原勾选来源） */
  paramsSnapshot: unknown;
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
    const { tenantId } = this.requireTenant();
    const session = (await this.prisma.forTenant.searchSession.update({
      where: { id: sessionId },
      data: {
        reports: {
          create: {
            // 嵌套 create 不会被租户扩展注入，需显式带 tenantId
            tenantId,
            contentMd: input.contentMd,
            paramsSnapshot: input.paramsSnapshot as object,
            tokenUsage: input.tokenUsage,
            sources: {
              create: input.sources.map(({ hit, idx, isCited }) => ({
                tenantId,
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

  // ===== 18 批 4：分段生成 / 断点续跑 =====

  /** 校验报告归属（经会话关联，非本租户视为不存在） */
  private async assertReportOwned(reportId: string): Promise<void> {
    const session = await this.prisma.forTenant.searchSession.findFirst({
      where: { reports: { some: { id: reportId } } },
      select: { id: true },
    });
    if (!session) {
      throw new BizException(ErrorCode.NOT_FOUND, '报告不存在', HttpStatus.NOT_FOUND);
    }
  }

  /**
   * 创建报告草稿（分段生成起点）：status=DRAFT、segmentIdx=0、正文为空；
   * 真正的正文由 saveSegment 逐章累积，completeReport 后转 COMPLETE。
   * 同时清理该会话遗留草稿，避免多次中断堆积。
   */
  async createDraftReport(
    sessionId: string,
    paramsSnapshot: Record<string, unknown>,
  ): Promise<{ id: string }> {
    // 先校验会话归属：下面的 deleteMany 走系统 client（无租户注入），不能省这步
    const { tenantId } = this.requireTenant();
    const owned = await this.prisma.forTenant.searchSession.findFirst({
      where: { id: sessionId },
      select: { id: true },
    });
    if (!owned) {
      throw new BizException(ErrorCode.NOT_FOUND, '会话不存在', HttpStatus.NOT_FOUND);
    }
    await this.prisma.searchReport.deleteMany({ where: { sessionId, tenantId, status: 'DRAFT' } });
    const session = (await this.prisma.forTenant.searchSession.update({
      where: { id: sessionId },
      data: {
        reports: {
          create: {
            // 嵌套 create 不会被租户扩展注入（扩展只处理顶层 data），必须显式带上
            tenantId,
            contentMd: '',
            paramsSnapshot: paramsSnapshot as object,
            tokenUsage: 0,
            status: 'DRAFT',
            segmentIdx: 0,
          },
        },
      },
      include: { reports: { orderBy: { createdAt: 'desc' }, take: 1 } },
    })) as unknown as { reports: Array<{ id: string }> };
    const report = session.reports[0];
    if (!report) {
      throw new BizException(
        ErrorCode.INTERNAL_ERROR,
        '报告草稿创建失败',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return { id: report.id };
  }

  /** 落章节（幂等 upsert）：续跑重复生成同一章时覆盖，不会产生重复段落 */
  async saveSegment(
    reportId: string,
    idx: number,
    heading: string,
    contentMd: string,
  ): Promise<void> {
    await this.assertReportOwned(reportId);
    const { tenantId } = this.requireTenant();
    await this.prisma.searchReportSegment.upsert({
      where: { reportId_idx: { reportId, idx } },
      // 走系统 client（上面已校验报告归属），tenantId 需显式带
      create: { tenantId, reportId, idx, heading, contentMd },
      update: { heading, contentMd },
    });
  }

  /** 更新草稿进度（累积正文 + 断点位置 + 用量） */
  async updateDraft(
    reportId: string,
    patch: { segmentIdx: number; contentMd: string; tokenUsage: number },
  ): Promise<void> {
    await this.assertReportOwned(reportId);
    await this.prisma.searchReport.update({
      where: { id: reportId },
      data: {
        segmentIdx: patch.segmentIdx,
        contentMd: patch.contentMd,
        tokenUsage: patch.tokenUsage,
      },
    });
  }

  /** 完成报告：写全文 + 状态转 COMPLETE + 落来源卡（先清旧来源，支持重试覆盖） */
  async completeReport(
    reportId: string,
    input: { contentMd: string; tokenUsage: number; sources: ReportInput['sources'] },
  ): Promise<void> {
    await this.assertReportOwned(reportId);
    const { tenantId } = this.requireTenant();
    await this.prisma.searchReport.update({
      where: { id: reportId },
      data: {
        contentMd: input.contentMd,
        tokenUsage: input.tokenUsage,
        status: 'COMPLETE',
        sources: {
          deleteMany: {},
          // 嵌套 create 不会被租户扩展注入，需显式带 tenantId
          create: input.sources.map(({ hit, idx, isCited }) => ({
            tenantId,
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
    });
  }

  /** 取会话的草稿报告（含已完成章节），无草稿返回 null（断点续跑用） */
  async getDraftReport(sessionId: string): Promise<DraftReport | null> {
    const session = await this.prisma.forTenant.searchSession.findFirst({
      where: { id: sessionId },
      include: {
        reports: {
          where: { status: 'DRAFT' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { segments: { orderBy: { idx: 'asc' } } },
        },
      },
    });
    const report = session?.reports[0];
    if (!report) return null;
    return {
      id: report.id,
      segmentIdx: report.segmentIdx,
      paramsSnapshot: report.paramsSnapshot,
      segments: report.segments.map((s) => ({
        idx: s.idx,
        heading: s.heading,
        contentMd: s.contentMd,
      })),
    };
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

  /** 历史会话列表（按用户，最新在前，分页）+ 真实总数（供前端分页器计算总页数） */
  async listSessions(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: SessionListItem[]; total: number }> {
    const skip = Math.max(0, (page - 1) * pageSize);
    const [sessions, total] = await Promise.all([
      this.prisma.forTenant.searchSession.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          // 18 批 4：只取已完成报告——DRAFT 草稿不参与历史展示（可在任务列表续跑）
          reports: { where: { status: 'COMPLETE' }, orderBy: { createdAt: 'desc' }, take: 1 },
          retrieval: { select: { id: true } },
        },
      }),
      this.prisma.forTenant.searchSession.count({ where: { userId } }),
    ]);
    return {
      total,
      items: sessions.map((s) => {
        const latest = s.reports[0];
        return {
          id: s.id,
          question: s.question,
          mode: s.mode,
          conditions: s.conditions as SearchConditions | null,
          createdAt: s.createdAt,
          reportId: latest?.id,
          reportCreatedAt: latest?.createdAt,
          // 17 两段式：有快照无报告 → 待选择（前端点击恢复选择态而非重搜）
          status: s.retrieval && !latest ? ('pending_selection' as const) : ('done' as const),
        };
      }),
    };
  }

  /** 清空用户全部智搜历史（报告/快照经 schema onDelete: Cascade 级联删除，tenant_id 由 Extension 注入） */
  async clearSessions(userId: string): Promise<{ deleted: number }> {
    const { tenantId } = this.requireTenant();
    const res = await this.prisma.forTenant.searchSession.deleteMany({
      where: { userId },
    });
    this.logger.log(`清空智搜历史: tenant=${tenantId} user=${userId} deleted=${res.count}`);
    return { deleted: res.count };
  }

  /**
   * 落检索快照（17 两段式第一段）：会话一对一 upsert（同会话重复检索覆盖旧快照）。
   * 同时**懒删除本租户已过期快照**（超过 TTL 的快照对生成/续跑一律已失效，
   * 行内 source 正文 JSON 较大，不清理会持续堆积）——沿用 search_uploads 的懒删除口径，
   * 不为此引入定时任务。
   * @param sources 精排后全量来源（含 idx 与 isCited）
   */
  async saveRetrieval(
    sessionId: string,
    question: string,
    mode: string,
    sources: Array<Omit<RetrievalSourceItem, 'contentMd'> & { contentMd: string }>,
  ): Promise<void> {
    await this.purgeExpiredRetrievals();
    const { tenantId } = this.requireTenant();
    await this.prisma.forTenant.searchRetrieval.upsert({
      where: { sessionId },
      create: {
        tenantId,
        sessionId,
        question,
        mode,
        sources: sources as unknown as Prisma.InputJsonValue,
      },
      update: { question, mode, sources: sources as unknown as Prisma.InputJsonValue },
    });
  }

  /**
   * 清理本租户已过期的检索快照（懒删除，返回删除条数）。
   * `search_retrieval` 现已带 tenant_id 并登记隔离，租户条件由扩展注入；
   * 此处仍显式带上 tenantId（破坏性操作，不依赖隐式行为）。
   */
  async purgeExpiredRetrievals(): Promise<number> {
    const { tenantId } = this.requireTenant();
    const deadline = new Date(Date.now() - RETRIEVAL_TTL_SECONDS * 1000);
    const { count } = await this.prisma.forTenant.searchRetrieval.deleteMany({
      where: { createdAt: { lt: deadline }, tenantId },
    });
    if (count > 0) this.logger.log(`清理过期检索快照 ${count} 条 tenant=${tenantId}`);
    return count;
  }

  /**
   * 取检索快照（含原始问题，生成阶段用）：跨租户/不存在返回 null。
   * 不做恢复窗口过滤（过期判定由调用方按 expiresInSeconds 语义处理）。
   */
  async getRetrieval(
    sessionId: string,
  ): Promise<{ question: string; mode: string; sources: RetrievalSourceItem[]; createdAt: Date } | null> {
    const row = await this.prisma.forTenant.searchRetrieval.findFirst({
      where: { sessionId },
      include: { session: { select: { question: true } } },
    });
    if (!row) return null;
    const sources = (row.sources as unknown as RetrievalSourceItem[]) ?? [];
    return { question: row.session.question, mode: row.mode, sources, createdAt: row.createdAt };
  }

  /** 报告详情（含来源卡；跨租户访问返回 404） */
  async reportDetail(sessionId: string): Promise<ReportDetail> {
    const session = await this.prisma.forTenant.searchSession.findFirst({
      where: { id: sessionId },
      include: {
        reports: {
          // 18 批 4：只返回已完成报告（草稿不可浏览/导出）
          where: { status: 'COMPLETE' },
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