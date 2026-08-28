import { describe, expect, it, vi } from 'vitest';
import { AdminMembersService } from '../src/modules/admin/members.service';
import { ErrorCode } from '@app/shared';

/** 构造最小可用的 Prisma mock（仅覆盖被测方法用到的模型） */
function buildPrisma(overrides: Record<string, unknown> = {}) {
  const prisma = {
    memberPlan: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(null),
    },
    memberOrder: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
    memberSubscription: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    message: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'm1' }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  };
  return prisma;
}

describe('AdminMembersService.listPlans（会员套餐）', () => {
  it('返回含 levelName/cycleName/enabled 的套餐行', async () => {
    const prisma = buildPrisma({
      memberPlan: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'p1',
            code: 'PRO_YEAR',
            level: 'PRO',
            cycle: 'YEAR',
            name: '专业版 · 年付',
            tag: null,
            badge: '最推荐',
            priceCents: 49900,
            originPriceCents: 70800,
            features: ['权益1'],
            sort: 3,
            enabled: true,
          },
        ]),
      },
    });
    const svc = new AdminMembersService(prisma as never);
    const plans = await svc.listPlans();
    expect(plans).toHaveLength(1);
    expect(plans[0].levelName).toBe('专业版');
    expect(plans[0].cycleName).toBe('年付');
    expect(plans[0].enabled).toBe(true);
  });
});

describe('AdminMembersService.createPlan（新增套餐）', () => {
  it('编码已存在 → 抛 CONFLICT', async () => {
    const prisma = buildPrisma({
      memberPlan: { findUnique: vi.fn().mockResolvedValue({ id: 'p1' }) },
    });
    const svc = new AdminMembersService(prisma as never);
    await expect(
      svc.createPlan({
        code: 'PRO_YEAR',
        level: 'PRO',
        cycle: 'YEAR',
        name: '专业版 · 年付',
        priceCents: 49900,
      }),
    ).rejects.toMatchObject({ bizCode: ErrorCode.CONFLICT });
  });

  it('正常创建返回套餐行', async () => {
    const prisma = buildPrisma();
    prisma.memberPlan.create = vi.fn().mockResolvedValue({
      id: 'p1',
      code: 'PRO_YEAR',
      level: 'PRO',
      cycle: 'YEAR',
      name: '专业版 · 年付',
      tag: null,
      badge: null,
      priceCents: 49900,
      originPriceCents: null,
      features: [],
      sort: 0,
      enabled: true,
    }) as never;
    const svc = new AdminMembersService(prisma as never);
    const plan = await svc.createPlan({
      code: 'PRO_YEAR',
      level: 'PRO',
      cycle: 'YEAR',
      name: '专业版 · 年付',
      priceCents: 49900,
    });
    expect(plan.code).toBe('PRO_YEAR');
    expect(plan.levelName).toBe('专业版');
  });
});

describe('AdminMembersService.listOrders（缴费订单跨租户）', () => {
  it('组装订单 + 用户信息', async () => {
    const prisma = buildPrisma({
      memberOrder: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'o1',
            orderNo: 'NO1',
            userId: 'u1',
            planSnapshot: { code: 'PRO_YEAR', name: '专业版 · 年付', level: 'PRO', cycle: 'YEAR', priceCents: 49900 },
            amountCents: 49900,
            channel: 'MOCK',
            status: 'PAID',
            paidAt: new Date(),
            createdAt: new Date(),
          },
        ]),
      },
      user: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'u1', username: 'li_research', realName: '李研究', phone: '13800000001', nickname: '李研究' }]),
      },
    });
    const svc = new AdminMembersService(prisma as never);
    const res = await svc.listOrders({ status: 'PAID', keyword: '', page: 1, pageSize: 20 });
    expect(res.total).toBe(1);
    expect(res.list[0].user.username).toBe('li_research');
    expect(res.list[0].levelName).toBe('专业版');
    expect(res.list[0].status).toBe('PAID');
  });
});

describe('AdminMembersService.listRenewals（7 天内到期）', () => {
  it('返回到期会员 + 提醒状态（已提醒）', async () => {
    const now = Date.now();
    const expireAt = new Date(now + 6 * 86_400_000);
    const prisma = buildPrisma({
      memberSubscription: {
        findMany: vi.fn().mockResolvedValue([
          { userId: 'u1', level: 'PRO', cycle: 'YEAR', expireAt },
        ]),
      },
      user: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'u1', username: 'li_research', realName: '李研究', phone: '138', nickname: '李研究' }]),
      },
      message: {
        findMany: vi.fn().mockResolvedValue([{ userId: 'u1', createdAt: new Date() }]),
      },
    });
    const svc = new AdminMembersService(prisma as never);
    const list = await svc.listRenewals();
    expect(list).toHaveLength(1);
    expect(list[0].levelName).toBe('专业版');
    expect(list[0].daysLeft).toBeGreaterThanOrEqual(5);
    expect(list[0].reminded).toBe(true);
  });
});

describe('AdminMembersService.sendRenewal（续费提醒）', () => {
  it('无有效会员 → 抛 NOT_FOUND', async () => {
    const prisma = buildPrisma();
    prisma.memberSubscription.findUnique = vi.fn().mockResolvedValue({ userId: 'u1', level: 'FREE', expireAt: null }) as never;
    const svc = new AdminMembersService(prisma as never);
    await expect(svc.sendRenewal('u1')).rejects.toMatchObject({ bizCode: ErrorCode.NOT_FOUND });
  });

  it('有效会员 → 写 RENEWAL 站内信', async () => {
    const prisma = buildPrisma();
    prisma.memberSubscription.findUnique = vi.fn().mockResolvedValue({
      userId: 'u1',
      level: 'PRO',
      cycle: 'YEAR',
      expireAt: new Date(Date.now() + 6 * 86_400_000),
    }) as never;
    const svc = new AdminMembersService(prisma as never);
    const res = await svc.sendRenewal('u1');
    expect(res.ok).toBe(true);
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'RENEWAL', userId: 'u1' }) }),
    );
  });
});

describe('AdminMembersService.batchRenewal（批量提醒）', () => {
  it('过滤无有效会员的用户，仅对有效会员写站内信', async () => {
    const prisma = buildPrisma({
      memberSubscription: {
        findMany: vi.fn().mockResolvedValue([
          { userId: 'u1', level: 'PRO', expireAt: new Date() },
          { userId: 'u2', level: 'PRO', expireAt: new Date() },
        ]),
      },
    });
    const svc = new AdminMembersService(prisma as never);
    const res = await svc.batchRenewal({ userIds: ['u1', 'u2', 'u3'] });
    expect(res.sent).toBe(2);
    expect(prisma.message.createMany).toHaveBeenCalledTimes(1);
  });
});
