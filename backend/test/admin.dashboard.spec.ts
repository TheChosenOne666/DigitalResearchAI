import { describe, expect, it } from 'vitest';
import {
  resolveRange,
  buildDailyBuckets,
  countByDay,
  startOfDay,
  formatDay,
  DashboardService,
} from '../src/modules/admin/dashboard.service';

describe('resolveRange（统计周期 → 起止区间）', () => {
  const now = new Date(2026, 7, 28, 15, 30, 0); // 2026-08-28 15:30

  it('today：从今日 00:00 到当前', () => {
    const r = resolveRange('today', now);
    expect(r.from).toEqual(new Date(2026, 7, 28, 0, 0, 0, 0));
    expect(r.to).toEqual(now);
  });

  it('7d（含今日）：从 7 天前 00:00 到当前', () => {
    const r = resolveRange('7d', now);
    expect(r.from).toEqual(new Date(2026, 7, 22, 0, 0, 0, 0));
  });

  it('30d（含今日）：从 30 天前 00:00 到当前', () => {
    const r = resolveRange('30d', now);
    expect(r.from).toEqual(new Date(2026, 6, 30, 0, 0, 0, 0));
  });

  it('未知范围按 7d 兜底', () => {
    const r = resolveRange('xxx', now);
    expect(r.from).toEqual(new Date(2026, 7, 22, 0, 0, 0, 0));
  });
});

describe('buildDailyBuckets（日期桶）', () => {
  it('跨月桶：08-26 起 7 天含 08-26..09-01', () => {
    const end = new Date(2026, 8, 1); // 09-01
    const buckets = buildDailyBuckets(end, 7);
    expect(buckets).toEqual([
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
    ]);
  });

  it('桶数量等于 days', () => {
    expect(buildDailyBuckets(new Date(2026, 0, 10), 30)).toHaveLength(30);
  });
});

describe('countByDay（按天聚合补零）', () => {
  const buckets = ['2026-08-26', '2026-08-27', '2026-08-28'];

  it('缺失的桶补 0，存在的桶计数', () => {
    const dates = [new Date(2026, 7, 26, 1), new Date(2026, 7, 26, 2), new Date(2026, 7, 28, 9)];
    expect(countByDay(dates, buckets)).toEqual([2, 0, 1]);
  });

  it('空列表 → 全 0', () => {
    expect(countByDay([], buckets)).toEqual([0, 0, 0]);
  });
});

describe('startOfDay / formatDay', () => {
  it('startOfDay 归一到 00:00:00.000', () => {
    const d = startOfDay(new Date(2026, 7, 28, 23, 59, 59, 999));
    expect(d).toEqual(new Date(2026, 7, 28, 0, 0, 0, 0));
  });

  it('formatDay 输出 YYYY-MM-DD（补零）', () => {
    expect(formatDay(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('DashboardService.overview（mock Prisma）', () => {
  /** 构造最小可用的 Prisma 代理（只覆盖 overview 用到的模型） */
  function buildPrisma(overrides: Record<string, unknown> = {}) {
    const prisma = {
      user: {
        count: () => Promise.resolve(10),
        findMany: () => Promise.resolve([]),
      },
      searchSession: {
        count: () => Promise.resolve(20),
        findMany: () => Promise.resolve([]),
      },
      memberOrder: {
        aggregate: () => Promise.resolve({ _sum: { amountCents: 1000 } }),
      },
      workspaceReport: { count: () => Promise.resolve(5) },
      kbChunk: { count: () => Promise.resolve(3) },
      importTask: { count: () => Promise.resolve(2) },
      kbDocument: { count: () => Promise.resolve(1) },
      memberSubscription: { count: () => Promise.resolve(4) },
      ...overrides,
    };
    return prisma as never;
  }

  it('正常聚合：KPI 与趋势结构正确，degraded=false', async () => {
    const svc = new DashboardService(buildPrisma());
    const r = await svc.overview('7d');
    expect(r.degraded).toBe(false);
    expect(r.kpis.totalUsers).toBe(10);
    expect(r.kpis.totalSearches).toBe(20);
    expect(r.kpis.incomeCents).toBe(1000);
    expect(r.trends.days).toHaveLength(7);
    expect(r.trends.newUsers).toHaveLength(7);
    expect(r.overview.reportCount).toBe(5);
  });

  it('单项统计失败 → 降级为 0 并置 degraded=true，不阻断整体', async () => {
    const prisma = buildPrisma({
      memberOrder: {
        aggregate: () => Promise.reject(new Error('db down')),
      },
    });
    const svc = new DashboardService(prisma);
    const r = await svc.overview('7d');
    expect(r.degraded).toBe(true);
    expect(r.kpis.incomeCents).toBe(0);
    // 其余项仍正常返回
    expect(r.kpis.totalUsers).toBe(10);
  });

  it('today 范围：range 回显 today', async () => {
    const svc = new DashboardService(buildPrisma());
    const r = await svc.overview('today');
    expect(r.range).toBe('today');
  });
});
