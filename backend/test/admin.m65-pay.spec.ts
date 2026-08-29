import { describe, expect, it, vi } from 'vitest';
import { AdminPayService } from '../src/modules/admin/pay-admin.service';
import { ErrorCode } from '@app/shared';
import { OrderStatus } from '../src/generated/prisma/client';

function buildConfig(values: Record<string, string> = {}) {
  return { get: (key: string, dflt?: string) => values[key] ?? dflt };
}

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    memberOrder: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    paymentRecord: { create: vi.fn().mockResolvedValue(null) },
    message: { create: vi.fn().mockResolvedValue(null) },
    payChannelConfig: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue(null) },
    ...overrides,
  };
}

describe('AdminPayService（支付中心 A-20）', () => {
  it('listOrders：状态/关键词筛选透传（非法状态被忽略）', async () => {
    const count = vi.fn().mockResolvedValue(1);
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'o1', tenantId: 't1', userId: 'u1', orderNo: 'ORD202608290001', planSnapshot: { name: '专业版', cycle: '单月' },
        amountCents: 49900, channel: 'MOCK', status: 'PAID', isRenewal: false, paidAt: new Date(), expireAt: null, createdAt: new Date(),
      },
    ]);
    const prisma = buildPrisma({ memberOrder: { ...buildPrisma().memberOrder, count, findMany } });
    const svc = new AdminPayService(prisma as never, buildConfig() as never);

    await svc.listOrders({ status: 'HACKED', page: 1, pageSize: 20 });
    expect(count).toHaveBeenNthCalledWith(1, { where: {} });

    const res = await svc.listOrders({ status: 'PAID', keyword: 'ORD', page: 1, pageSize: 20 });
    expect(res.total).toBe(1);
    expect(count).toHaveBeenLastCalledWith({ where: expect.objectContaining({ status: 'PAID' }) });
    const row = res.list[0];
    expect(row).toMatchObject({ orderNo: 'ORD202608290001', planName: '专业版', amountCents: 49900, status: 'PAID' });
  });

  it('refund：非 PAID 订单被拒', async () => {
    const prisma = buildPrisma({
      memberOrder: {
        ...buildPrisma().memberOrder,
        findUnique: vi.fn().mockResolvedValue({ id: 'o1', orderNo: 'ORD1', status: OrderStatus.PENDING, amountCents: 100 }),
      },
    });
    const svc = new AdminPayService(prisma as never, buildConfig() as never);
    await expect(svc.refund('ORD1', { reason: '重复支付' })).rejects.toMatchObject({ bizCode: ErrorCode.CONFLICT });
  });

  it('refund：PAID → REFUNDED + REFUND 负数流水 + 站内信；并发冲突抛错', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const paymentCreate = vi.fn().mockResolvedValue(null);
    const messageCreate = vi.fn().mockResolvedValue(null);
    const order = {
      id: 'o1', tenantId: 't1', userId: 'u1', orderNo: 'ORD1', amountCents: 49900,
      channel: 'MOCK', status: OrderStatus.PAID,
    };
    const tx = {
      memberOrder: {
        updateMany,
        findUnique: vi.fn().mockResolvedValue({ ...order, status: OrderStatus.REFUNDED }),
      },
      paymentRecord: { create: paymentCreate },
      message: { create: messageCreate },
    };
    const prisma = buildPrisma({
      memberOrder: { ...buildPrisma().memberOrder, findUnique: vi.fn().mockResolvedValue(order) },
    });
    (prisma as { $transaction: unknown }).$transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx));
    const svc = new AdminPayService(prisma as never, buildConfig() as never);

    const res = await svc.refund('ORD1', { reason: '用户申请退款' });
    expect(res.status).toBe(OrderStatus.REFUNDED);
    expect(res.transactionNo).toMatch(/^R:ORD1:\d+$/);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', status: OrderStatus.PAID },
      data: { status: OrderStatus.REFUNDED },
    });
    expect(paymentCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REFUND', amountCents: -49900, transactionNo: res.transactionNo }),
    }));
    expect(messageCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'u1', type: 'SYSTEM' }),
    }));

    // 并发重复退款：updateMany 条件不满足 → 冲突
    (prisma as { $transaction: unknown }).$transaction = vi.fn(async (fn: (t: typeof tx) => unknown) =>
      fn({
        ...tx,
        memberOrder: { ...tx.memberOrder, updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      }));
    await expect(svc.refund('ORD1', { reason: '重复退款' })).rejects.toMatchObject({ bizCode: ErrorCode.CONFLICT });
  });

  it('close：仅待支付/回调异常订单可关闭', async () => {
    const prisma = buildPrisma({
      memberOrder: {
        ...buildPrisma().memberOrder,
        findUnique: vi.fn().mockResolvedValue({ id: 'o1', orderNo: 'ORD1', status: OrderStatus.PAID }),
      },
    });
    const svc = new AdminPayService(prisma as never, buildConfig() as never);
    await expect(svc.close('ORD1')).rejects.toMatchObject({ bizCode: ErrorCode.CONFLICT });

    const update = vi.fn().mockResolvedValue({ id: 'o1', orderNo: 'ORD1', status: OrderStatus.CLOSED });
    const prisma2 = buildPrisma({
      memberOrder: {
        ...buildPrisma().memberOrder,
        findUnique: vi.fn().mockResolvedValue({ id: 'o1', orderNo: 'ORD1', status: OrderStatus.PENDING }),
        update,
      },
    });
    const svc2 = new AdminPayService(prisma2 as never, buildConfig() as never);
    await expect(svc2.close('ORD1')).resolves.toMatchObject({ status: OrderStatus.CLOSED });
  });

  it('listChannels：hasKey 只回状态不回密钥', async () => {
    const prisma = buildPrisma({
      payChannelConfig: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'c1', channel: 'MOCK', merchantId: 'M1', notifyUrl: '', secretEnc: 'iv.tag.cipher', enabled: true, keyUpdatedAt: new Date(), createdAt: new Date() },
          { id: 'c2', channel: 'WECHAT', merchantId: null, notifyUrl: null, secretEnc: null, enabled: false, keyUpdatedAt: null, createdAt: new Date() },
        ]),
      },
    });
    const svc = new AdminPayService(prisma as never, buildConfig() as never);
    const rows = await svc.listChannels();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ channel: 'MOCK', hasKey: true });
    expect(rows[1]).toMatchObject({ channel: 'WECHAT', hasKey: false });
    expect(JSON.stringify(rows)).not.toContain('iv.tag.cipher');
  });

  it('updateChannelKey：AES-256-GCM 加密存储（iv.tag.ciphertext），不回明文', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'c1', channel: 'WECHAT', keyUpdatedAt: new Date() });
    const prisma = buildPrisma({
      payChannelConfig: {
        ...buildPrisma().payChannelConfig,
        findUnique: vi.fn().mockResolvedValue({ id: 'c1', channel: 'WECHAT' }),
        update,
      },
    });
    const svc = new AdminPayService(prisma as never, buildConfig({ SECRET_ENC_KEY: 'unit-test-enc-key' }) as never);
    const res = await svc.updateChannelKey('c1', { secret: 'wx-merchant-secret-123' });
    expect(res.hasKey).toBe(true);

    const arg = update.mock.calls[0][0] as { data: { secretEnc: string; keyUpdatedAt: Date } };
    const parts = arg.data.secretEnc.split('.');
    expect(parts).toHaveLength(3);
    expect(arg.data.secretEnc).not.toContain('wx-merchant-secret-123');
    expect(arg.data.keyUpdatedAt).toBeInstanceOf(Date);
  });

  it('updateChannel：渠道不存在被拒，编辑生效', async () => {
    const prisma = buildPrisma({
      payChannelConfig: {
        ...buildPrisma().payChannelConfig,
        findUnique: vi.fn().mockResolvedValue(null),
      },
    });
    const svc = new AdminPayService(prisma as never, buildConfig() as never);
    await expect(svc.updateChannel('x', { enabled: true })).rejects.toMatchObject({ bizCode: ErrorCode.NOT_FOUND });

    const update = vi.fn().mockResolvedValue({ id: 'c1', channel: 'MOCK', enabled: false });
    const prisma2 = buildPrisma({
      payChannelConfig: {
        ...buildPrisma().payChannelConfig,
        findUnique: vi.fn().mockResolvedValue({ id: 'c1', channel: 'MOCK' }),
        update,
      },
    });
    const svc2 = new AdminPayService(prisma2 as never, buildConfig() as never);
    await expect(svc2.updateChannel('c1', { enabled: false })).resolves.toMatchObject({ enabled: false });
  });
});
