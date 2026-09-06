import { HttpStatus, Injectable } from '@nestjs/common';
import { getTenantContext } from '../../common/auth/tenant-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import type { MemberLevel, PlanCycle } from '../../generated/prisma/client';

/** 会员订阅行 */
export interface SubscriptionRow {
  id: string;
  userId: string;
  level: MemberLevel;
  cycle: PlanCycle | null;
  expireAt: Date | null;
  autoRenew: boolean;
  totalPeriods: number;
}

/**
 * 会员订阅与免费配额持久化（M5）：租户级数据（经 forTenant 强制注入 tenant_id）。
 * 支付回调系统态方法（*System 后缀）显式传 tenantId 走系统 client。
 */
@Injectable()
export class SubscriptionStoreService {
  constructor(private readonly prisma: PrismaService) {}

  /** 当前请求租户上下文（受保护路由由拦截器注入；缺失视为未授权） */
  private requireTenant(): { tenantId: string } {
    const ctx = getTenantContext();
    if (!ctx) {
      throw new BizException(ErrorCode.UNAUTHORIZED, '缺少租户上下文', HttpStatus.UNAUTHORIZED);
    }
    return { tenantId: ctx.tenantId };
  }

  // ===== 订阅 =====

  /** 当前用户订阅（无记录返回 null） */
  async getSubscription(userId: string): Promise<SubscriptionRow | null> {
    const r = await this.prisma.forTenant.memberSubscription.findFirst({ where: { userId } });
    return r ? toSubscriptionRow(r) : null;
  }

  /** 读订阅（系统上下文，回调入账时计算续费基准用） */
  async getSubscriptionSystem(userId: string): Promise<SubscriptionRow | null> {
    const r = await this.prisma.memberSubscription.findFirst({ where: { userId } });
    return r ? toSubscriptionRow(r) : null;
  }

  /**
   * 写入/更新订阅（支付成功后调用）：同事务内由调用方保证幂等。
   * 新用户首次开通时创建记录，续费时更新等级/周期/到期时间并累加期数。
   */
  async upsertSubscription(input: {
    userId: string;
    level: MemberLevel;
    cycle: PlanCycle;
    periodStart: Date;
    periodEnd: Date;
  }): Promise<SubscriptionRow> {
    const { tenantId } = this.requireTenant();
    const r = await this.prisma.forTenant.memberSubscription.upsert({
      where: { userId: input.userId },
      create: {
        tenantId,
        userId: input.userId,
        level: input.level,
        cycle: input.cycle,
        expireAt: input.periodEnd,
        totalPeriods: 1,
      },
      update: {
        level: input.level,
        cycle: input.cycle,
        expireAt: input.periodEnd,
        totalPeriods: { increment: 1 },
      },
    });
    return toSubscriptionRow(r);
  }

  /** 开关连续包月自动续费（无订阅记录时创建一条 FREE 占位） */
  async setAutoRenew(userId: string, enabled: boolean): Promise<SubscriptionRow> {
    const { tenantId } = this.requireTenant();
    const r = await this.prisma.forTenant.memberSubscription.upsert({
      where: { userId },
      create: { tenantId, userId, autoRenew: enabled },
      update: { autoRenew: enabled },
    });
    return toSubscriptionRow(r);
  }

  // ===== 免费体验配额（持久化兜底；Redis 为主，见 QuotaService）=====

  /** 读取已用次数（无记录为 0） */
  async getTrialUsed(userId: string): Promise<number> {
    const r = await this.prisma.forTenant.trialQuota.findFirst({ where: { userId } });
    return r?.usedCount ?? 0;
  }

  /** 覆盖写已用次数（Redis 计数为准，DB 仅对账，故用幂等覆盖而非累加） */
  async setTrialUsed(userId: string, usedCount: number): Promise<void> {
    const { tenantId } = this.requireTenant();
    await this.prisma.forTenant.trialQuota.upsert({
      where: { userId },
      create: { tenantId, userId, usedCount },
      update: { usedCount },
    });
  }
}

/** 订阅行转换（统一对外形状） */
function toSubscriptionRow(r: {
  id: string;
  userId: string;
  level: MemberLevel;
  cycle: PlanCycle | null;
  expireAt: Date | null;
  autoRenew: boolean;
  totalPeriods: number;
}): SubscriptionRow {
  return {
    id: r.id,
    userId: r.userId,
    level: r.level,
    cycle: r.cycle,
    expireAt: r.expireAt,
    autoRenew: r.autoRenew,
    totalPeriods: r.totalPeriods,
  };
}
