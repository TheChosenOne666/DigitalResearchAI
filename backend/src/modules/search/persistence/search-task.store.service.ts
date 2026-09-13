import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ErrorCode } from '@app/shared';
import { BizException } from '../../../common/exceptions/biz.exception';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { getTenantContext } from '../../../common/auth/tenant-context';
import { RETRIEVAL_TTL_SECONDS } from '../search.constants';

/** 任务类型（retrieval=检索 / generate=生成） */
export type SearchTaskType = 'retrieval' | 'generate';

/** 任务状态机 */
export type SearchTaskStatus =
  | 'RETRIEVING'
  | 'PENDING_SELECT'
  | 'GENERATING'
  | 'DONE'
  | 'RETRIEVAL_FAILED'
  | 'GENERATE_FAILED'
  | 'ABORTED';

/** 进行中状态（真正占用 SSE/LLM 资源；PENDING_SELECT 只在等用户操作，不算活跃） */
export const ACTIVE_TASK_STATUSES: SearchTaskStatus[] = ['RETRIEVING', 'GENERATING'];

/** 列表筛选分组 → 状态集合 */
const STATUS_GROUPS: Record<'active' | 'done' | 'failed', SearchTaskStatus[]> = {
  active: ['RETRIEVING', 'PENDING_SELECT', 'GENERATING'],
  done: ['DONE'],
  failed: ['RETRIEVAL_FAILED', 'GENERATE_FAILED', 'ABORTED'],
};

/** 任务行（对外形状，question 由所属会话组装） */
export interface SearchTaskRow {
  id: string;
  sessionId: string;
  type: SearchTaskType;
  status: SearchTaskStatus;
  progress: number;
  errorMsg: string | null;
  /** 所属会话的问题（列表展示用） */
  question: string;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
  /**
   * 剩余可续跑秒数（仅「生成类 + 中断/失败态」的任务有值）：
   * 由检索快照有效期折算，0 表示快照已过期、需重新检索后才能生成。
   */
  resumableSeconds: number | null;
}

/** 可续跑状态（仅生成类任务中断/失败后可「继续生成」） */
const RESUMABLE_STATUSES: SearchTaskStatus[] = ['GENERATE_FAILED', 'ABORTED'];

/**
 * 计算剩余可续跑秒数。
 * 续跑需复用检索快照，故窗口 = 快照创建时间 + `RETRIEVAL_TTL_SECONDS`；
 * 快照已被清理（无 createdAt）视为 0，交由前端引导「重新检索」。
 * @param type 任务类型（非生成类不涉及续跑）
 * @param status 任务状态
 * @param retrievalCreatedAt 所属会话的检索快照创建时间（缺失表示快照不存在）
 * @returns 剩余秒数；不可续跑的任务返回 null（前端据此不展示该提示）
 */
function resumableSecondsOf(
  type: SearchTaskType,
  status: SearchTaskStatus,
  retrievalCreatedAt: Date | undefined,
): number | null {
  if (type !== 'generate' || !RESUMABLE_STATUSES.includes(status)) return null;
  if (!retrievalCreatedAt) return 0;
  const elapsed = (Date.now() - retrievalCreatedAt.getTime()) / 1000;
  return Math.max(0, Math.floor(RETRIEVAL_TTL_SECONDS - elapsed));
}

/**
 * 智搜任务持久化（18 批 4 任务管控）。
 * 全部经 `PrismaService.forTenant`（Extension 自动注入 tenant_id），再按 userId 过滤到本人。
 */
@Injectable()
export class SearchTaskStoreService {
  private readonly logger = new Logger(SearchTaskStoreService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 当前请求租户上下文（受保护路由由拦截器注入；缺失视为未授权） */
  private requireTenant(): { tenantId: string; userId: string } {
    const ctx = getTenantContext();
    if (!ctx) {
      throw new BizException(ErrorCode.UNAUTHORIZED, '缺少租户上下文', HttpStatus.UNAUTHORIZED);
    }
    return { tenantId: ctx.tenantId, userId: ctx.userId };
  }

  /**
   * 创建任务。
   * @param sessionId 所属会话
   * @param type 任务类型
   * @param status 初始状态
   */
  async create(
    sessionId: string,
    type: SearchTaskType,
    status: SearchTaskStatus,
  ): Promise<{ id: string }> {
    const { tenantId, userId } = this.requireTenant();
    const task = await this.prisma.forTenant.searchTask.create({
      data: { tenantId, userId, sessionId, type, status },
    });
    return { id: task.id };
  }

  /**
   * 推进任务状态（幂等：先校验归属，任务不存在/非本人抛 404）。
   * @param taskId 任务 id
   * @param patch 变更字段
   */
  async update(
    taskId: string,
    patch: {
      status?: SearchTaskStatus;
      progress?: number;
      errorMsg?: string | null;
      /** 是否标记结束（写 finishedAt） */
      finish?: boolean;
    },
  ): Promise<void> {
    const { userId } = this.requireTenant();
    const data: Record<string, unknown> = {};
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.progress !== undefined) data.progress = Math.max(0, Math.min(100, patch.progress));
    if (patch.errorMsg !== undefined) data.errorMsg = patch.errorMsg;
    if (patch.finish) data.finishedAt = new Date();

    const { count } = await this.prisma.forTenant.searchTask.updateMany({
      where: { id: taskId, userId },
      data,
    });
    if (count === 0) {
      this.logger.warn(`任务状态更新未命中 task=${taskId}（不存在或非本人）`);
    }
  }

  /**
   * 条件推进状态（CAS）：仅当任务当前状态属于 `from` 时才更新。
   * 用于「续跑抢占」——防止并发/重复点击导致同一任务被双跑（双跑会重复计 token 用量）。
   * @returns 是否抢占成功（false = 状态已被其它请求改变）
   */
  async updateIfStatus(
    taskId: string,
    from: SearchTaskStatus[],
    patch: { status: SearchTaskStatus; progress?: number; errorMsg?: string | null },
  ): Promise<boolean> {
    const { userId } = this.requireTenant();
    const data: Record<string, unknown> = { status: patch.status };
    if (patch.progress !== undefined) data.progress = Math.max(0, Math.min(100, patch.progress));
    if (patch.errorMsg !== undefined) data.errorMsg = patch.errorMsg;

    const { count } = await this.prisma.forTenant.searchTask.updateMany({
      where: { id: taskId, userId, status: { in: from } },
      data,
    });
    return count > 0;
  }

  /**
   * 任务列表（按创建时间倒序，可按状态分组筛选）。
   * @param params.status 分组：active/done/failed，缺省全部
   */
  async list(params: {
    status?: 'active' | 'done' | 'failed';
    page: number;
    pageSize: number;
  }): Promise<{ items: SearchTaskRow[]; total: number }> {
    const { userId } = this.requireTenant();
    const where: Record<string, unknown> = { userId };
    if (params.status) where.status = { in: STATUS_GROUPS[params.status] };

    const skip = Math.max(0, (params.page - 1) * params.pageSize);
    const [tasks, total] = await Promise.all([
      this.prisma.forTenant.searchTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: params.pageSize,
      }),
      this.prisma.forTenant.searchTask.count({ where }),
    ]);

    // 批量取所属会话的问题（避免 N+1；任务表不冗余存问题）
    const sessionIds = [...new Set(tasks.map((t) => t.sessionId))];
    const sessions = sessionIds.length
      ? await this.prisma.forTenant.searchSession.findMany({
          where: { id: { in: sessionIds } },
          select: { id: true, question: true },
        })
      : [];
    const questionById = new Map(sessions.map((s) => [s.id, s.question]));

    // 批量取检索快照创建时间（同样避免 N+1）：用于折算各任务的剩余可续跑窗口
    const retrievals = sessionIds.length
      ? await this.prisma.forTenant.searchRetrieval.findMany({
          where: { sessionId: { in: sessionIds } },
          select: { sessionId: true, createdAt: true },
        })
      : [];
    const retrievalAtBySession = new Map(retrievals.map((r) => [r.sessionId, r.createdAt]));

    return {
      total,
      items: tasks.map((t) =>
        this.toRow(t, questionById.get(t.sessionId) ?? '', retrievalAtBySession.get(t.sessionId)),
      ),
    };
  }

  /** 取单个任务（非本人/不存在返回 null，由调用方转 404） */
  async get(taskId: string): Promise<SearchTaskRow | null> {
    const { userId } = this.requireTenant();
    const task = await this.prisma.forTenant.searchTask.findFirst({ where: { id: taskId, userId } });
    if (!task) return null;
    const session = await this.prisma.forTenant.searchSession.findFirst({
      where: { id: task.sessionId },
      select: { question: true },
    });
    const retrieval = await this.prisma.forTenant.searchRetrieval.findFirst({
      where: { sessionId: task.sessionId },
      select: { createdAt: true },
    });
    return this.toRow(task, session?.question ?? '', retrieval?.createdAt);
  }

  /** 取某会话最新任务（生成入口用于推进/复用任务） */
  async findLatestBySession(
    sessionId: string,
    type?: SearchTaskType,
  ): Promise<SearchTaskRow | null> {
    const { userId } = this.requireTenant();
    const task = await this.prisma.forTenant.searchTask.findFirst({
      where: { sessionId, userId, ...(type ? { type } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return task ? this.toRow(task, '') : null;
  }

  /** 删除任务记录（不连带删除报告） */
  async remove(taskId: string): Promise<boolean> {
    const { userId } = this.requireTenant();
    const { count } = await this.prisma.forTenant.searchTask.deleteMany({
      where: { id: taskId, userId },
    });
    return count > 0;
  }

  /**
   * 僵尸任务收敛（服务启动时调用）：把「进行中」但超过 timeoutMs 未更新的任务置为失败，
   * 避免服务重启后遗留「永远卡在生成中」的任务。
   * **按任务类型区分失败状态**：生成任务转 `GENERATE_FAILED`（有草稿可续跑），
   * 检索任务转 `RETRIEVAL_FAILED`（无草稿，只能重新检索）——否则前端会对检索任务提示
   * 「继续生成」而点下去 404。
   * 走系统 client（跨租户批量修复，运维场景）。
   * @returns 收敛条数
   */
  async reapStale(timeoutMs: number): Promise<number> {
    const deadline = new Date(Date.now() - timeoutMs);
    try {
      const [gen, ret] = await this.prisma.$transaction([
        this.prisma.searchTask.updateMany({
          where: { status: 'GENERATING', updatedAt: { lt: deadline } },
          data: {
            status: 'GENERATE_FAILED',
            errorMsg: '服务重启导致任务中断，可继续生成',
            finishedAt: new Date(),
          },
        }),
        this.prisma.searchTask.updateMany({
          where: { status: 'RETRIEVING', updatedAt: { lt: deadline } },
          data: {
            status: 'RETRIEVAL_FAILED',
            errorMsg: '服务重启导致检索中断，请重新检索',
            finishedAt: new Date(),
          },
        }),
      ]);
      const count = gen.count + ret.count;
      if (count > 0) {
        this.logger.warn(
          `收敛僵尸任务 ${count} 条（生成 ${gen.count} / 检索 ${ret.count}，超时 ${timeoutMs}ms 未更新）`,
        );
      }
      return count;
    } catch (e) {
      this.logger.warn(`僵尸任务收敛失败：${(e as Error).message}`);
      return 0;
    }
  }

  /** Prisma 行 → 对外形状 */
  private toRow(
    t: {
      id: string;
      sessionId: string;
      type: string;
      status: string;
      progress: number;
      errorMsg: string | null;
      createdAt: Date;
      updatedAt: Date;
      finishedAt: Date | null;
    },
    question: string,
    retrievalCreatedAt?: Date,
  ): SearchTaskRow {
    return {
      id: t.id,
      sessionId: t.sessionId,
      type: t.type as SearchTaskType,
      status: t.status as SearchTaskStatus,
      progress: t.progress,
      errorMsg: t.errorMsg,
      question,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      finishedAt: t.finishedAt,
      resumableSeconds: resumableSecondsOf(
        t.type as SearchTaskType,
        t.status as SearchTaskStatus,
        retrievalCreatedAt,
      ),
    };
  }
}
