import type { MemberLevel, PlanCycle } from '../../generated/prisma/client';

/** 会员订阅最小形状（DB 行或测试构造对象均可） */
export interface SubscriptionLike {
  level: MemberLevel;
  cycle: PlanCycle | null;
  expireAt: Date | null;
  autoRenew?: boolean;
}

/**
 * 月份累加（纯函数）：处理月末进位，如 1/31 + 1 月 → 2/28（闰年 2/29）。
 * 不直接 setMonth，避免 JS 溢出到下月（1/31 → 3/3）。
 */
export function addMonths(base: Date, months: number): Date {
  const day = base.getDate();
  const target = new Date(base.getTime());
  target.setDate(1);
  target.setMonth(target.getMonth() + months);
  // 目标月最后一天（下月第 0 天）
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target;
}

/**
 * 计算会员到期时间（纯函数）：
 * - SINGLE / MONTHLY → 基准 + 1 个月
 * - YEAR → 基准 + 1 年
 * 基准由调用方给出（同等级续费为原到期日，跨等级/新开为当前时间）。
 */
export function calcPeriodEnd(base: Date, cycle: PlanCycle): Date {
  return cycle === 'YEAR' ? addMonths(base, 12) : addMonths(base, 1);
}

/**
 * 续费基准时间（纯函数）：
 * - 当前订阅有效且同等级 → 以「当前时间 / 原到期日」中较晚者为基准（未到期续费不浪费天数）
 * - 跨等级升级或新开通 → 以当前时间为基准
 */
export function calcPeriodBase(
  current: SubscriptionLike | null,
  targetLevel: MemberLevel,
  now: Date,
): Date {
  const active = isMemberEffective(current, now);
  if (active && current && current.level === targetLevel && current.expireAt) {
    return current.expireAt > now ? current.expireAt : now;
  }
  return now;
}

/**
 * 会员是否有效（纯函数）：等级非 FREE、有到期时间且未过期。
 * 到期当日仍有效（到期时间落在该日 23:59:59.999）。
 */
export function isMemberEffective(sub: SubscriptionLike | null, now: Date): boolean {
  if (!sub) return false;
  if (sub.level === 'FREE') return false;
  if (!sub.expireAt) return false;
  return now.getTime() <= sub.expireAt.getTime();
}

/** 剩余天数（纯函数）：按自然日向上取整，已过期为 0 */
export function daysLeft(expireAt: Date | null, now: Date): number {
  if (!expireAt) return 0;
  const ms = expireAt.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
}

/** 到期日归一到当日 23:59:59.999（使到期当日整天有效） */
export function endOfDay(date: Date): Date {
  const d = new Date(date.getTime());
  d.setHours(23, 59, 59, 999);
  return d;
}
