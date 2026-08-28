import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { PayService } from '../src/modules/member/pay/pay.service';
import { MockPayChannel } from '../src/modules/member/pay/mock.channel';
import { PayChannelRegistry } from '../src/modules/member/pay/pay-channel';
import type { MemberStoreService } from '../src/modules/member/member.store.service';
import type { MemberOrder } from '../src/generated/prisma/client';

/** 构造订单行（覆盖测试需要的字段） */
function makeOrder(over: Partial<MemberOrder> = {}): MemberOrder {
  const now = new Date();
  return {
    id: 'o1',
    tenantId: 't1',
    userId: 'u1',
    orderNo: 'ORD1',
    planId: 'p1',
    planSnapshot: { code: 'PRO_YEAR', name: '专业版 · 年付', level: 'PRO', cycle: 'YEAR', priceCents: 49900 },
    amountCents: 49900,
    channel: 'MOCK',
    status: 'PENDING',
    periodStart: null,
    periodEnd: null,
    payInfo: null,
    paidAt: null,
    expireAt: new Date(now.getTime() + 30 * 60_000),
    isRenewal: false,
    createdAt: now,
    updatedAt: now,
    ...over,
  } as MemberOrder;
}

let store: MemberStoreService;
let pay: PayService;
let channel: MockPayChannel;

beforeEach(() => {
  const config = {
    get: <T>(_k: string, def: T): T => (_k === 'PAY_MOCK_SECRET' ? ('test-secret' as unknown as T) : def),
  } as unknown as ConfigService;
  channel = new MockPayChannel(config);
  store = {
    findPaymentByTxn: vi.fn().mockResolvedValue(null),
    getOrderByNoSystem: vi.fn().mockResolvedValue(makeOrder()),
    getSubscriptionSystem: vi.fn().mockResolvedValue(null),
    createPaymentSystem: vi.fn().mockResolvedValue(undefined),
    settlePayment: vi.fn().mockResolvedValue(true),
  } as unknown as MemberStoreService;
  pay = new PayService(store, new PayChannelRegistry([channel]));
});

/** 生成一次合法回调报文 */
function notify(orderNo = 'ORD1', amountCents = 49900, transactionNo = 'TXN1') {
  return channel.buildNotify({ orderNo, transactionNo, amountCents });
}

describe('PayService.handleNotify（入账与幂等）', () => {
  it('正常入账：写成功流水 + 事务入账 + 返回生效区间', async () => {
    const payload = notify();
    const res = await pay.handleNotify('MOCK', payload);
    expect(res.ok).toBe(true);
    expect(res.duplicate).toBeUndefined();
    expect(res.periodEnd).toBeTruthy();
    expect(store.settlePayment).toHaveBeenCalledTimes(1);
    expect(store.createPaymentSystem).not.toHaveBeenCalled();
  });

  it('回调重放（同一流水号）→ 幂等命中，不重复入账', async () => {
    const payload = notify();
    await pay.handleNotify('MOCK', payload);
    // 第二次：流水已存在
    (store.findPaymentByTxn as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'pay1', orderId: 'o1', status: 'SUCCESS' });
    const res = await pay.handleNotify('MOCK', payload);
    expect(res).toEqual({ ok: true, duplicate: true });
    expect(store.settlePayment).toHaveBeenCalledTimes(1);
  });

  it('回调重放不重复延期：第二次调用不触发 settlePayment', async () => {
    const payload = notify();
    await pay.handleNotify('MOCK', payload);
    const callsAfterFirst = (store.settlePayment as ReturnType<typeof vi.fn>).mock.calls.length;
    (store.findPaymentByTxn as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'pay1', orderId: 'o1', status: 'SUCCESS' });
    await pay.handleNotify('MOCK', payload);
    expect((store.settlePayment as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst);
  });

  it('订单已支付 + 新流水号 → 记 FAILED 流水，返回 ORDER_NOT_PENDING', async () => {
    (store.getOrderByNoSystem as ReturnType<typeof vi.fn>).mockResolvedValue(makeOrder({ status: 'PAID' }));
    const res = await pay.handleNotify('MOCK', notify('ORD1', 49900, 'TXN2'));
    expect(res).toEqual({ ok: false, reason: 'ORDER_NOT_PENDING' });
    expect(store.createPaymentSystem).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ status: 'FAILED', transactionNo: 'TXN2' }),
    );
    expect(store.settlePayment).not.toHaveBeenCalled();
  });

  it('金额不符 → 记 FAILED 流水，返回 AMOUNT_MISMATCH', async () => {
    const res = await pay.handleNotify('MOCK', notify('ORD1', 100));
    expect(res).toEqual({ ok: false, reason: 'AMOUNT_MISMATCH' });
    expect(store.createPaymentSystem).toHaveBeenCalled();
    expect(store.settlePayment).not.toHaveBeenCalled();
  });

  it('订单不存在 → 404', async () => {
    (store.getOrderByNoSystem as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(pay.handleNotify('MOCK', notify())).rejects.toMatchObject({ bizCode: 4001 });
  });

  it('验签失败 → 400 且不落任何数据', async () => {
    const payload = { ...notify(), amountCents: 1 };
    await expect(pay.handleNotify('MOCK', payload)).rejects.toMatchObject({ bizCode: 3001 });
    expect(store.settlePayment).not.toHaveBeenCalled();
    expect(store.createPaymentSystem).not.toHaveBeenCalled();
  });

  it('未注册渠道 → 400', async () => {
    await expect(pay.handleNotify('WECHAT', notify())).rejects.toMatchObject({ bizCode: 3002 });
  });

  it('并发抢先（settlePayment 返回 false）→ 幂等命中', async () => {
    (store.settlePayment as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const res = await pay.handleNotify('MOCK', notify());
    expect(res).toEqual({ ok: true, duplicate: true });
  });

  it('续费：以原到期日为基准累加（不浪费剩余天数）', async () => {
    const expireAt = new Date(Date.now() + 10 * 86_400_000);
    (store.getSubscriptionSystem as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 's1',
      userId: 'u1',
      level: 'PRO',
      cycle: 'YEAR',
      expireAt,
      autoRenew: true,
      totalPeriods: 1,
    });
    const res = await pay.handleNotify('MOCK', notify());
    const call = (store.settlePayment as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.periodStart).toEqual(expireAt);
    expect(new Date(call.periodEnd).getTime()).toBeGreaterThan(expireAt.getTime());
    expect(res.ok).toBe(true);
  });

  it('跨等级升级：以当前时间为基准，不继承低等级到期日', async () => {
    (store.getSubscriptionSystem as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 's1',
      userId: 'u1',
      level: 'PRO',
      cycle: 'YEAR',
      expireAt: new Date(Date.now() + 200 * 86_400_000),
      autoRenew: false,
      totalPeriods: 1,
    });
    (store.getOrderByNoSystem as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeOrder({
        planSnapshot: { code: 'ENT_YEAR', name: '企业版 · 年付', level: 'ENTERPRISE', cycle: 'YEAR', priceCents: 399900 },
        amountCents: 399900,
      }),
    );
    await pay.handleNotify('MOCK', notify('ORD1', 399900, 'TXN3'));
    const call = (store.settlePayment as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // 基准 ≈ 当前时间（远小于原到期日）
    expect(call.periodStart.getTime()).toBeLessThan(Date.now() + 1000);
  });
});

describe('PayService.mockPay（开发联调模拟支付）', () => {
  it('订单本人 + 待支付 → 走真实回调链路入账', async () => {
    const res = await pay.mockPay('ORD1', 'u1');
    expect(res.ok).toBe(true);
    expect(store.settlePayment).toHaveBeenCalledTimes(1);
  });

  it('他人订单 → 403', async () => {
    await expect(pay.mockPay('ORD1', 'u2')).rejects.toMatchObject({ bizCode: 2001 });
  });

  it('非待支付订单 → 409', async () => {
    (store.getOrderByNoSystem as ReturnType<typeof vi.fn>).mockResolvedValue(makeOrder({ status: 'PAID' }));
    await expect(pay.mockPay('ORD1', 'u1')).rejects.toMatchObject({ bizCode: 4002 });
  });

  it('订单不存在 → 404', async () => {
    (store.getOrderByNoSystem as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(pay.mockPay('ORD_X', 'u1')).rejects.toMatchObject({ bizCode: 4001 });
  });
});
