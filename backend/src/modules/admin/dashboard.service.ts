import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/** 运营看板统计周期 */
export type RangeKey = 'today' | '7d' | '30d';

/** 日期区间（左闭右闭，to 为当前时刻） */
export interface DateRange {
  from: Date;
  to: Date;
}

/** 运营看板 KPI */
export interface DashboardKpis {
  totalUsers: number;
  newUsers: number;
  totalSearches: number;
  todaySearches: number;
  incomeCents: number;
}

/** 运营看板趋势（固定近 7 日，对齐原型「用户量趋势 / 检索量趋势」） */
export interface DashboardTrends {
  /** 日期标签（MM-DD） */
  days: string[];
  /** 每日新增用户 */
  newUsers: number[];
  /** 每日活跃用户 */
  activeUsers: number[];
  /** 每日检索次数 */
  searches: number[];
}

/** 运营看板待办提醒 */
export interface DashboardTodos {
  /** 数据接入审核待办 */
  importPending: number;
  /** 知识入库审核待办 */
  kbReviewPending: number;
  /** 7 天内到期会员 */
  expiringMembers: number;
}

/** 近 7 日运营概览 */
export interface DashboardSummary {
  activeUsers: number;
  avgSearches: number;
  reportCount: number;
  newChunks: number;
}

/** 运营看板聚合结果 */
export interface DashboardOverview {
  /** 统计周期 */
  range: RangeKey;
  /** 是否有统计项失败（失败项以 0 兜底，前端提示刷新失败） */
  degraded: boolean;
  kpis: DashboardKpis;
  trends: DashboardTrends;
  todos: DashboardTodos;
  overview: DashboardSummary;
}

/** 取当天 00:00:00（本地时区） */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** 日期加减天数 */
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
}

/** 格式化为 YYYY-MM-DD（本地时区，用于分桶键） */
export function formatDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * 解析统计周期：today=今日；7d=近 7 日（含今日）；30d=近 30 日（含今日）；未知值按 7d。
 * @param key 周期键
 * @param now 基准时间（默认当前）
 */
export function resolveRange(key: string, now: Date = new Date()): DateRange {
  const to = now;
  if (key === 'today') return { from: startOfDay(now), to };
  const days = key === '30d' ? 30 : 7;
  return { from: startOfDay(addDays(now, -(days - 1))), to };
}

/**
 * 生成近 n 日日期桶（升序，MM-DD 标签）。
 * @param end 结束日（含）
 * @param days 天数（默认 7）
 */
export function buildDailyBuckets(end: Date, days = 7): string[] {
  const buckets: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    buckets.push(formatDay(addDays(end, -i)));
  }
  return buckets;
}

/**
 * 按天聚合计数：把日期列表映射到桶上，缺失的桶补 0。
 * @param dates 待统计的日期列表
 * @param buckets 日期桶（YYYY-MM-DD）
 */
export function countByDay(dates: Date[], buckets: string[]): number[] {
  const counts = new Map<string, number>();
  for (const d of dates) {
    const key = formatDay(d);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return buckets.map((b) => counts.get(b) ?? 0);
}

/** 安全的统计执行：失败返回兜底值并标记降级（不阻断整块看板） */
async function safeCount<T>(task: Promise<T>, fallback: T, state: { degraded: boolean }, logger: Logger): Promise<T> {
  try {
    return await task;
  } catch (e) {
    state.degraded = true;
    logger.warn(`运营看板统计项失败，已降级：${(e as Error).message}`);
    return fallback;
  }
}

/**
 * 运营看板统计服务（A-01）：聚合用户量 / 检索量 / 收入与待办提醒。
 * 全部查询走系统 client（跨租户平台级视角，D1）；任一统计项失败时降级为 0 并置 degraded。
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 汇总运营看板数据。
   * @param range 统计周期（today / 7d / 30d）
   */
  async overview(range: string): Promise<DashboardOverview> {
    const key: RangeKey = range === 'today' || range === '30d' ? range : '7d';
    const now = new Date();
    const { from } = resolveRange(key, now);
    const trendFrom = startOfDay(addDays(now, -6));
    const expiringTo = addDays(now, 7);
    const state = { degraded: false };
    const guard = <T>(task: Promise<T>, fallback: T) => safeCount(task, fallback, state, this.logger);

    const [
      totalUsers,
      newUsers,
      activeUsers,
      totalSearches,
      todaySearches,
      windowSearches,
      incomeCents,
      reportCount,
      newChunks,
      importPending,
      kbReviewPending,
      expiringMembers,
      userRows,
      activeRows,
      searchRows,
    ] = await Promise.all([
      guard(this.prisma.user.count(), 0),
      guard(this.prisma.user.count({ where: { createdAt: { gte: from } } }), 0),
      guard(this.prisma.user.count({ where: { lastLoginAt: { gte: from } } }), 0),
      guard(this.prisma.searchSession.count(), 0),
      guard(this.prisma.searchSession.count({ where: { createdAt: { gte: startOfDay(now) } } }), 0),
      guard(this.prisma.searchSession.count({ where: { createdAt: { gte: from } } }), 0),
      guard(
        this.prisma.memberOrder
          .aggregate({ _sum: { amountCents: true }, where: { status: 'PAID', paidAt: { gte: from, lte: now } } })
          .then((r) => r._sum.amountCents ?? 0),
        0,
      ),
      guard(this.prisma.workspaceReport.count({ where: { createdAt: { gte: from } } }), 0),
      guard(this.prisma.kbChunk.count({ where: { createdAt: { gte: from } } }), 0),
      guard(this.prisma.importTask.count({ where: { status: 'PENDING' } }), 0),
      guard(this.prisma.kbDocument.count({ where: { status: 'PENDING' } }), 0),
      guard(
        this.prisma.memberSubscription.count({
          where: { level: { not: 'FREE' }, expireAt: { gte: now, lte: expiringTo } },
        }),
        0,
      ),
      // 趋势：仅取时间字段在内存分桶（演示数据量可控；大数据量时改 SQL date_trunc 分组）
      guard(
        this.prisma.user
          .findMany({ where: { createdAt: { gte: trendFrom } }, select: { createdAt: true } })
          .then((rows) => rows.map((r) => r.createdAt)),
        [] as Date[],
      ),
      guard(
        this.prisma.user
          .findMany({
            where: { lastLoginAt: { gte: trendFrom } },
            select: { lastLoginAt: true },
          })
          .then((rows) => rows.flatMap((r) => (r.lastLoginAt ? [r.lastLoginAt] : []))),
        [] as Date[],
      ),
      guard(
        this.prisma.searchSession
          .findMany({ where: { createdAt: { gte: trendFrom } }, select: { createdAt: true } })
          .then((rows) => rows.map((r) => r.createdAt)),
        [] as Date[],
      ),
    ]);

    const buckets = buildDailyBuckets(now, 7);
    const avgSearches = activeUsers > 0 ? Math.round((windowSearches / activeUsers) * 10) / 10 : 0;

    return {
      range: key,
      degraded: state.degraded,
      kpis: { totalUsers, newUsers, totalSearches, todaySearches, incomeCents },
      trends: {
        days: buckets.map((b) => b.slice(5)),
        newUsers: countByDay(userRows, buckets),
        activeUsers: countByDay(activeRows, buckets),
        searches: countByDay(searchRows, buckets),
      },
      todos: { importPending, kbReviewPending, expiringMembers },
      overview: { activeUsers, avgSearches, reportCount, newChunks },
    };
  }
}
