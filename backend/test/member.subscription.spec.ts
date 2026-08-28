import { describe, it, expect } from 'vitest';
import {
  addMonths,
  calcPeriodBase,
  calcPeriodEnd,
  daysLeft,
  endOfDay,
  isMemberEffective,
  type SubscriptionLike,
} from '../src/modules/member/subscription';

describe('addMonths（月末进位）', () => {
  it('普通日期加 1 个月', () => {
    expect(addMonths(new Date(2026, 0, 15), 1)).toEqual(new Date(2026, 1, 15));
  });

  it('1/31 加 1 个月 → 2/28（平年，不溢出到 3 月）', () => {
    expect(addMonths(new Date(2026, 0, 31), 1)).toEqual(new Date(2026, 1, 28));
  });

  it('1/31 加 1 个月 → 2/29（闰年）', () => {
    expect(addMonths(new Date(2028, 0, 31), 1)).toEqual(new Date(2028, 1, 29));
  });

  it('跨年加月份：12/15 + 1 → 次年 1/15', () => {
    expect(addMonths(new Date(2026, 11, 15), 1)).toEqual(new Date(2027, 0, 15));
  });

  it('加 12 个月回到同月同日', () => {
    expect(addMonths(new Date(2026, 7, 10), 12)).toEqual(new Date(2027, 7, 10));
  });
});

describe('calcPeriodEnd（周期 → 到期时间）', () => {
  it('单月 / 连续包月 → +1 个月', () => {
    const base = new Date(2026, 7, 10, 9, 30);
    expect(calcPeriodEnd(base, 'SINGLE')).toEqual(new Date(2026, 8, 10, 9, 30));
    expect(calcPeriodEnd(base, 'MONTHLY')).toEqual(new Date(2026, 8, 10, 9, 30));
  });

  it('年付 → +12 个月', () => {
    expect(calcPeriodEnd(new Date(2026, 7, 10, 9, 30), 'YEAR')).toEqual(new Date(2027, 7, 10, 9, 30));
  });
});

describe('calcPeriodBase（续费基准）', () => {
  const now = new Date(2026, 7, 1, 12, 0);

  it('新开通 → 以当前时间为基准', () => {
    expect(calcPeriodBase(null, 'PRO', now)).toEqual(now);
  });

  it('同等级未到期续费 → 以原到期日为基准（不浪费天数）', () => {
    const sub: SubscriptionLike = { level: 'PRO', cycle: 'MONTHLY', expireAt: new Date(2026, 8, 15) };
    expect(calcPeriodBase(sub, 'PRO', now)).toEqual(new Date(2026, 8, 15));
  });

  it('同等级已过期续费 → 以当前时间为基准', () => {
    const sub: SubscriptionLike = { level: 'PRO', cycle: 'MONTHLY', expireAt: new Date(2026, 5, 15) };
    expect(calcPeriodBase(sub, 'PRO', now)).toEqual(now);
  });

  it('跨等级升级 → 以当前时间为基准（不累加旧等级剩余天数）', () => {
    const sub: SubscriptionLike = {
      level: 'PRO',
      cycle: 'YEAR',
      expireAt: new Date(2027, 5, 15),
    };
    expect(calcPeriodBase(sub, 'ENTERPRISE', now)).toEqual(now);
  });
});

describe('isMemberEffective / daysLeft', () => {
  it('FREE 等级不算会员', () => {
    expect(isMemberEffective({ level: 'FREE', cycle: null, expireAt: null }, new Date())).toBe(false);
  });

  it('无订阅记录不算会员', () => {
    expect(isMemberEffective(null, new Date())).toBe(false);
  });

  it('未到期为会员，过期为非会员', () => {
    const now = new Date(2026, 7, 1, 12, 0);
    const sub: SubscriptionLike = {
      level: 'PRO',
      cycle: 'MONTHLY',
      expireAt: new Date(2026, 7, 20, 23, 59, 59, 999),
    };
    expect(isMemberEffective(sub, now)).toBe(true);
    expect(isMemberEffective(sub, new Date(2026, 7, 21, 0, 0, 0))).toBe(false);
  });

  it('剩余天数按自然日向上取整，过期为 0', () => {
    const now = new Date(2026, 7, 1, 12, 0);
    expect(daysLeft(new Date(2026, 7, 20, 23, 59, 59, 999), now)).toBe(20);
    expect(daysLeft(new Date(2026, 7, 1, 23, 59, 59, 999), now)).toBe(1);
    expect(daysLeft(new Date(2026, 6, 31, 23, 59, 59, 999), now)).toBe(0);
    expect(daysLeft(null, now)).toBe(0);
  });

  it('endOfDay 归一到当日 23:59:59.999（到期当日仍有效）', () => {
    const d = endOfDay(new Date(2026, 7, 10, 8, 0));
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
    expect(d.getSeconds()).toBe(59);
    expect(d.getMilliseconds()).toBe(999);
  });
});
