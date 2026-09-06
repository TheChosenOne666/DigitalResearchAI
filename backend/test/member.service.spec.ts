import { describe, it, expect, vi } from 'vitest';
import { MemberService } from '../src/modules/member/member.service';
import type { PlanStoreService } from '../src/modules/member/plan.store.service';
import type { SubscriptionStoreService } from '../src/modules/member/subscription.store.service';
import type { QuotaService } from '../src/modules/member/quota.service';
import { MEMBER_PLAN_SEEDS } from '../src/modules/member/plans';

/** 构造套餐 store mock（只覆盖被测试方法用到的成员） */
function makePlanStore(over: Partial<Record<keyof PlanStoreService, unknown>> = {}) {
  return {
    ensureSeedPlans: vi.fn().mockResolvedValue(MEMBER_PLAN_SEEDS.length),
    listPlans: vi.fn().mockResolvedValue(
      MEMBER_PLAN_SEEDS.map((p, i) => ({
        id: `plan_${i}`,
        code: p.code,
        level: p.level,
        cycle: p.cycle,
        name: p.name,
        tag: p.tag,
        badge: p.badge,
        priceCents: p.priceCents,
        originPriceCents: p.originPriceCents,
        features: p.features,
        sort: p.sort,
      })),
    ),
    ...over,
  } as unknown as PlanStoreService;
}

/** 构造订阅 store mock */
function makeSubscriptionStore(
  over: Partial<Record<keyof SubscriptionStoreService, unknown>> = {},
) {
  return {
    getSubscription: vi.fn().mockResolvedValue(null),
    setAutoRenew: vi.fn().mockResolvedValue({ id: 's1', autoRenew: true }),
    setTrialUsed: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as SubscriptionStoreService;
}

/** 构造配额服务 mock（trialLeft 默认 1 次） */
function makeQuota(trialLeft: number | null = 1) {
  return {
    trialLeft: vi.fn().mockResolvedValue(trialLeft),
    consumeTrial: vi.fn().mockResolvedValue({ allowed: true, trialLeft }),
  } as unknown as QuotaService;
}

/** 构造会员服务 */
function makeService(
  planStore: PlanStoreService = makePlanStore(),
  subscriptionStore: SubscriptionStoreService = makeSubscriptionStore(),
  quota: QuotaService = makeQuota(),
): MemberService {
  return new MemberService(planStore, subscriptionStore, quota);
}

describe('MemberService.onModuleInit', () => {
  it('启动时幂等同步套餐种子', async () => {
    const planStore = makePlanStore();
    await makeService(planStore).onModuleInit();
    expect(planStore.ensureSeedPlans).toHaveBeenCalledTimes(1);
  });
});

describe('MemberService.listPlans', () => {
  it('返回按等级分组的套餐与免费体验上限', async () => {
    const res = await makeService().listPlans();
    expect(res.trialLimit).toBe(1);
    expect(res.levels.map((l) => l.level)).toEqual(['PRO', 'ENTERPRISE']);
    expect(res.levels[0].plans).toHaveLength(3);
  });
});

describe('MemberService.getStatus', () => {
  it('非会员：等级 FREE，剩余体验 1 次', async () => {
    const st = await makeService().getStatus('u1');
    expect(st.isMember).toBe(false);
    expect(st.level).toBe('FREE');
    expect(st.trialLeft).toBe(1);
    expect(st.expireAt).toBeNull();
    expect(st.daysLeft).toBe(0);
  });

  it('体验已用完：剩余 0 次', async () => {
    const st = await makeService(makePlanStore(), makeSubscriptionStore(), makeQuota(0)).getStatus('u1');
    expect(st.trialLeft).toBe(0);
  });

  it('有效会员：返回等级/周期/到期/剩余天数，体验次数不限（null）', async () => {
    const expireAt = new Date(Date.now() + 20 * 86_400_000);
    const subscriptionStore = makeSubscriptionStore({
      getSubscription: vi
        .fn()
        .mockResolvedValue({ id: 's1', level: 'PRO', cycle: 'YEAR', expireAt, autoRenew: true, totalPeriods: 2 }),
    });
    const st = await makeService(makePlanStore(), subscriptionStore, makeQuota(null)).getStatus('u1');
    expect(st.isMember).toBe(true);
    expect(st.level).toBe('PRO');
    expect(st.levelName).toBe('专业版');
    expect(st.cycleName).toBe('年付');
    expect(st.expireAt).toBe(expireAt.toISOString());
    expect(st.daysLeft).toBe(20);
    expect(st.autoRenew).toBe(true);
    expect(st.totalPeriods).toBe(2);
    expect(st.trialLeft).toBeNull();
  });

  it('已过期会员：降级为非会员，等级回落 FREE', async () => {
    const subscriptionStore = makeSubscriptionStore({
      getSubscription: vi.fn().mockResolvedValue({
        id: 's1',
        level: 'PRO',
        cycle: 'MONTHLY',
        expireAt: new Date(Date.now() - 86_400_000),
        autoRenew: false,
        totalPeriods: 1,
      }),
    });
    const st = await makeService(makePlanStore(), subscriptionStore).getStatus('u1');
    expect(st.isMember).toBe(false);
    expect(st.level).toBe('FREE');
    expect(st.expireAt).toBeNull();
    expect(st.trialLeft).toBe(1);
  });
});

describe('MemberService.setAutoRenew', () => {
  it('透传开关并返回结果', async () => {
    await expect(makeService().setAutoRenew('u1', true)).resolves.toEqual({ autoRenew: true });
  });
});

describe('MemberService.previewPeriod', () => {
  it('新开通：从当前时间起算一个周期', async () => {
    const now = new Date();
    const { periodStart, periodEnd } = await makeService().previewPeriod('u1', 'PRO', 'MONTHLY');
    expect(periodStart.getTime()).toBeGreaterThanOrEqual(now.getTime() - 1000);
    // 到期日归一到当日 23:59:59.999，故约为 1 个月后
    expect(periodEnd.getTime() - periodStart.getTime()).toBeGreaterThan(29 * 86_400_000);
  });

  it('同等级续费：在原到期日上累加', async () => {
    const expireAt = new Date(Date.now() + 10 * 86_400_000);
    const subscriptionStore = makeSubscriptionStore({
      getSubscription: vi
        .fn()
        .mockResolvedValue({ id: 's1', level: 'PRO', cycle: 'MONTHLY', expireAt, autoRenew: false, totalPeriods: 1 }),
    });
    const { periodStart, periodEnd } = await makeService(makePlanStore(), subscriptionStore).previewPeriod('u1', 'PRO', 'MONTHLY');
    expect(periodStart).toEqual(expireAt);
    expect(periodEnd.getTime()).toBeGreaterThan(expireAt.getTime() + 28 * 86_400_000);
  });
});
