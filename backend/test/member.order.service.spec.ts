import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { OrderService, generateOrderNo } from '../src/modules/member/order.service';
import { MockPayChannel } from '../src/modules/member/pay/mock.channel';
import { PayChannelRegistry } from '../src/modules/member/pay/pay-channel';
import type { MemberStoreService } from '../src/modules/member/member.store.service';
import type { MemberOrder } from '../src/generated/prisma/client';

const PLAN = {
  id: 'p_year',
  code: 'PRO_YEAR',
  level: 'PRO' as const,
  cycle: 'YEAR' as const,
  name: '专业版 · 年付',
  tag: '个人研究首选',
  priceCents: 49900,
  originPriceCents: 70800,
  badge: '最推荐',
  features: ['AI 智搜无限次'],
  sort: 3,
};

/** 构造订单行 */
function makeOrder(over: Partial<MemberOrder> = {}): MemberOrder {
  const now = new Date();
  return {
    id: 'o1',
    tenantId: 't1',
    userId: 'u1',
    orderNo: 'ORD202608281200000001',
    planId: 'p_year',
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
let svc: OrderService;

beforeEach(() => {
  const config = {
    get: <T>(_k: string, def: T): T => (_k === 'PAY_MOCK_SECRET' ? ('test-secret' as unknown as T) : def),
  } as unknown as ConfigService;
  store = {
    getPlan: vi.fn().mockResolvedValue(PLAN),
    createOrder: vi.fn().mockResolvedValue(makeOrder()),
    getOrderByNo: vi.fn().mockResolvedValue(makeOrder()),
    findPendingOrder: vi.fn().mockResolvedValue(null),
    getSubscription: vi.fn().mockResolvedValue(null),
    findPlan: vi.fn().mockResolvedValue(PLAN),
    updateOrderStatus: vi.fn().mockResolvedValue(true),
    attachPayInfo: vi.fn().mockResolvedValue(undefined),
    listOrders: vi.fn().mockResolvedValue({ list: [makeOrder()], total: 1 }),
  } as unknown as MemberStoreService;
  svc = new OrderService(store, new PayChannelRegistry([new MockPayChannel(config)]));
});

describe('generateOrderNo', () => {
  it('ORD + 14 位时间戳 + 4 位随机，共 21 位', () => {
    const no = generateOrderNo(new Date(2026, 7, 28, 9, 5, 3));
    expect(no).toMatch(/^ORD20260828090503\d{4}$/);
    expect(no).toHaveLength(21);
  });
});

describe('OrderService.createOrder', () => {
  it('落单并返回对外视图（金额换算 + 中文状态/周期名）', async () => {
    const view = await svc.createOrder('u1', { planId: 'p_year' });
    expect(view.amount).toBe(499);
    expect(view.amountCents).toBe(49900);
    expect(view.status).toBe('PENDING');
    expect(view.statusName).toBe('待支付');
    expect(view.cycleName).toBe('年付');
    expect(view.levelName).toBe('专业版');
    expect(view.channelName).toBe('模拟支付');
    expect(store.createOrder).toHaveBeenCalledTimes(1);
  });

  it('套餐不存在 → 404', async () => {
    (store.getPlan as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error('套餐不存在'), { bizCode: 4001 }),
    );
    await expect(svc.createOrder('u1', { planId: 'nope' })).rejects.toMatchObject({ bizCode: 4001 });
  });
});

describe('OrderService.pay', () => {
  it('待支付订单 → 返回渠道预支付参数并回写 payInfo', async () => {
    const { order, payInfo } = await svc.pay('u1', 'ORD202608281200000001');
    expect(order.status).toBe('PENDING');
    expect(payInfo.cashierUrl).toContain('/pay/mock?orderNo=');
    expect(store.attachPayInfo).toHaveBeenCalledTimes(1);
  });

  it('订单已超时 → 置为 CLOSED 并报 409', async () => {
    (store.getOrderByNo as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeOrder({ expireAt: new Date(Date.now() - 1000) }),
    );
    await expect(svc.pay('u1', 'ORD202608281200000001')).rejects.toMatchObject({ bizCode: 4002 });
    expect(store.updateOrderStatus).toHaveBeenCalledWith('o1', ['PENDING'], 'CLOSED');
  });

  it('订单已支付 → 409', async () => {
    (store.getOrderByNo as ReturnType<typeof vi.fn>).mockResolvedValue(makeOrder({ status: 'PAID' }));
    await expect(svc.pay('u1', 'ORD202608281200000001')).rejects.toMatchObject({ bizCode: 4002 });
  });

  it('他人订单 → 404（不泄漏订单是否存在）', async () => {
    await expect(svc.pay('u2', 'ORD202608281200000001')).rejects.toMatchObject({ bizCode: 4001 });
  });
});

describe('OrderService.cancel', () => {
  it('待支付 → 取消成功', async () => {
    (store.getOrderByNo as ReturnType<typeof vi.fn>).mockResolvedValue(makeOrder({ status: 'CANCELLED' }));
    const view = await svc.cancel('u1', 'ORD202608281200000001');
    expect(view.status).toBe('CANCELLED');
  });

  it('已取消重复调用 → 幂等成功，不再改状态', async () => {
    (store.getOrderByNo as ReturnType<typeof vi.fn>).mockResolvedValue(makeOrder({ status: 'CANCELLED' }));
    await svc.cancel('u1', 'ORD202608281200000001');
    expect(store.updateOrderStatus).not.toHaveBeenCalled();
  });

  it('已支付订单 → 409', async () => {
    (store.getOrderByNo as ReturnType<typeof vi.fn>).mockResolvedValue(makeOrder({ status: 'PAID' }));
    await expect(svc.cancel('u1', 'ORD202608281200000001')).rejects.toMatchObject({ bizCode: 4002 });
  });
});

describe('OrderService.pendingOrder（到期懒续费）', () => {
  it('已有待支付订单 → 直接返回，不重复建单', async () => {
    (store.findPendingOrder as ReturnType<typeof vi.fn>).mockResolvedValue(makeOrder());
    const view = await svc.pendingOrder('u1');
    expect(view?.orderNo).toBe('ORD202608281200000001');
    expect(store.createOrder).not.toHaveBeenCalled();
  });

  it('连续包月 + 会员已过期 → 自动生成续费订单（isRenewal）', async () => {
    (store.getSubscription as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 's1',
      userId: 'u1',
      level: 'PRO',
      cycle: 'MONTHLY',
      expireAt: new Date(Date.now() - 86_400_000),
      autoRenew: true,
      totalPeriods: 1,
    });
    await svc.pendingOrder('u1');
    expect(store.findPlan).toHaveBeenCalledWith('PRO', 'MONTHLY');
    expect(store.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ isRenewal: true, channel: 'MOCK' }),
    );
  });

  it('会员仍在有效期 → 不生成续费单', async () => {
    (store.getSubscription as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 's1',
      userId: 'u1',
      level: 'PRO',
      cycle: 'MONTHLY',
      expireAt: new Date(Date.now() + 86_400_000),
      autoRenew: true,
      totalPeriods: 1,
    });
    await svc.pendingOrder('u1');
    expect(store.createOrder).not.toHaveBeenCalled();
  });

  it('未开启自动续费 → 不生成续费单', async () => {
    (store.getSubscription as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 's1',
      userId: 'u1',
      level: 'PRO',
      cycle: 'MONTHLY',
      expireAt: new Date(Date.now() - 86_400_000),
      autoRenew: false,
      totalPeriods: 1,
    });
    await svc.pendingOrder('u1');
    expect(store.createOrder).not.toHaveBeenCalled();
  });
});

describe('OrderService.list', () => {
  it('分页参数透传并返回总数', async () => {
    const res = await svc.list('u1', { status: 'PAID', page: 2, pageSize: 10 });
    expect(res.total).toBe(1);
    expect(res.page).toBe(2);
    expect(res.pageSize).toBe(10);
    expect(store.listOrders).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PAID', page: 2, pageSize: 10 }),
    );
  });

  it('非法状态值被忽略（不拼入查询条件）', async () => {
    await svc.list('u1', { status: 'unknown', page: 1, pageSize: 20 });
    const call = (store.listOrders as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect('status' in call).toBe(false);
  });
});
