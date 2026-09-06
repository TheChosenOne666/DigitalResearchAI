import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { getTenantContext } from '../../common/auth/tenant-context';
import { PlanStoreService } from './plan.store.service';
import { SubscriptionStoreService } from './subscription.store.service';
import { QuotaService } from './quota.service';
import { groupPlansByLevel, FREE_TRIAL_LIMIT } from './plans';
import { calcPeriodBase, calcPeriodEnd, daysLeft, endOfDay, isMemberEffective } from './subscription';
import { CYCLE_NAMES, LEVEL_NAMES } from './plans';
import type { MemberLevel, PlanCycle } from '../../generated/prisma/client';

/** 会员状态（会员中心状态卡 / 支付中心联动条数据源） */
export interface MemberStatus {
  /** 是否会员（等级非 FREE 且未过期） */
  isMember: boolean;
  /** 等级编码 */
  level: MemberLevel;
  /** 等级名 */
  levelName: string;
  /** 周期（非会员为 null） */
  cycle: PlanCycle | null;
  /** 周期名（非会员为 null） */
  cycleName: string | null;
  /** 到期时间（ISO；非会员为 null） */
  expireAt: string | null;
  /** 剩余天数（非会员为 0） */
  daysLeft: number;
  /** 连续包月自动续费开关 */
  autoRenew: boolean;
  /** 累计开通期数 */
  totalPeriods: number;
  /** 免费体验剩余次数（会员为 null 表示不限） */
  trialLeft: number | null;
}

/**
 * 会员编排服务（M5）：
 * - 模块启动时幂等同步套餐种子
 * - 套餐列表按等级分组（会员中心三列卡片）
 * - 会员状态聚合（等级/周期/到期/剩余天数/免费体验剩余）
 */
@Injectable()
export class MemberService implements OnModuleInit {
  private readonly logger = new Logger(MemberService.name);

  constructor(
    private readonly planStore: PlanStoreService,
    private readonly subscriptionStore: SubscriptionStoreService,
    private readonly quota: QuotaService,
  ) {}

  /** 启动即确保套餐数据存在（幂等 upsert，缺失补齐、不覆盖既有配置） */
  async onModuleInit(): Promise<void> {
    await this.planStore.ensureSeedPlans();
  }

  /** 套餐列表（按等级分组，组内按周期排序） */
  async listPlans(): Promise<{
    levels: ReturnType<typeof groupPlansByLevel>;
    trialLimit: number;
  }> {
    const plans = await this.planStore.listPlans();
    return { levels: groupPlansByLevel(plans), trialLimit: FREE_TRIAL_LIMIT };
  }

  /**
   * 当前用户会员状态（含免费体验剩余）。
   * 会员判定：等级非 FREE 且未过期；到期当日仍有效。
   */
  async getStatus(userId: string): Promise<MemberStatus> {
    const sub = await this.subscriptionStore.getSubscription(userId);
    const now = new Date();
    const isMember = isMemberEffective(sub, now);
    // 免费体验剩余以 Redis 计数为准（会员/管理员返回 null 表示不限）
    const roles = getTenantContext()?.roles ?? [];
    const trialLeft = await this.quota.trialLeft(userId, roles);
    const level: MemberLevel = isMember && sub ? sub.level : 'FREE';
    return {
      isMember,
      level,
      levelName: LEVEL_NAMES[level],
      cycle: isMember ? sub?.cycle ?? null : null,
      cycleName: isMember && sub?.cycle ? CYCLE_NAMES[sub.cycle] : null,
      expireAt: isMember && sub?.expireAt ? sub.expireAt.toISOString() : null,
      daysLeft: isMember && sub?.expireAt ? daysLeft(sub.expireAt, now) : 0,
      autoRenew: sub?.autoRenew ?? false,
      totalPeriods: sub?.totalPeriods ?? 0,
      trialLeft,
    };
  }

  /** 连续包月自动续费开关 */
  async setAutoRenew(userId: string, enabled: boolean): Promise<{ autoRenew: boolean }> {
    const sub = await this.subscriptionStore.setAutoRenew(userId, enabled);
    this.logger.log(`自动续费开关: userId=${userId} enabled=${enabled}`);
    return { autoRenew: sub.autoRenew };
  }

  /**
   * 计算下单将生效的会员区间（下单前预览，支付成功时按同一规则写入）。
   * 同等级续费在原到期日累加，跨等级/新开从当前时间起算。
   */
  async previewPeriod(
    userId: string,
    level: MemberLevel,
    cycle: PlanCycle,
  ): Promise<{ periodStart: Date; periodEnd: Date }> {
    const sub = await this.subscriptionStore.getSubscription(userId);
    const now = new Date();
    const base = calcPeriodBase(sub, level, now);
    const periodEnd = endOfDay(calcPeriodEnd(base, cycle));
    return { periodStart: base, periodEnd };
  }
}
