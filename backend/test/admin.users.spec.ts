import { describe, expect, it, vi } from 'vitest';
import { AdminUsersService } from '../src/modules/admin/users.service';
import { tenantAls } from '../src/common/auth/tenant-context';
import { ErrorCode } from '@app/shared';

vi.mock('bcryptjs', () => ({
  hash: async (pwd: string) => `hashed:${pwd}`,
}));

/** 构造最小可用的 Prisma mock（仅覆盖被测方法用到的模型） */
function buildPrisma(overrides: Record<string, unknown> = {}) {
  const prisma = {
    user: {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(null),
    },
    role: {
      findUnique: vi.fn().mockResolvedValue({ id: 'r1', code: 'USER' }),
      findMany: vi.fn().mockResolvedValue([{ id: 'r1', code: 'USER' }]),
    },
    tenant: { create: vi.fn().mockResolvedValue({ id: 't1' }) },
    userRole: {
      count: vi.fn().mockResolvedValue(2),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    message: { create: vi.fn().mockResolvedValue({ id: 'm1' }) },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    ...overrides,
  };
  return prisma;
}

describe('AdminUsersService.list（列表分页 + 筛选）', () => {
  it('解析分页参数并调用 count + findMany', async () => {
    const prisma = buildPrisma();
    const svc = new AdminUsersService(prisma as never);
    const res = await svc.list({ keyword: '', role: '', status: '', page: 2, pageSize: 10 });
    expect(res.page).toBe(2);
    expect(res.pageSize).toBe(10);
    expect(prisma.user.count).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
  });
});

describe('AdminUsersService.create（新增用户）', () => {
  it('手机号已存在 → 抛 CONFLICT', async () => {
    const prisma = buildPrisma({
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'dup' }) },
    });
    const svc = new AdminUsersService(prisma as never);
    await expect(
      svc.create({ username: 'u1', realName: '张', phone: '13800000000', role: 'USER', password: '123456' }),
    ).rejects.toMatchObject({ bizCode: ErrorCode.CONFLICT });
  });

  it('用户名已存在 → 抛 CONFLICT', async () => {
    const prisma = buildPrisma();
    prisma.user.findFirst = vi
      .fn()
      .mockImplementation((args: { where: { username?: string; phone?: string } }) =>
        Promise.resolve(args?.where?.username === 'admin' ? { id: 'dup' } : null),
      ) as never;
    const svc = new AdminUsersService(prisma as never);
    await expect(
      svc.create({ username: 'admin', realName: '张', phone: '13800000000', role: 'USER', password: '123456' }),
    ).rejects.toMatchObject({ bizCode: ErrorCode.CONFLICT });
  });

  it('正常创建：建租户 + 用户 + 角色，密码经 bcrypt 哈希', async () => {
    const created = {
      id: 'u1',
      username: 'u1',
      realName: '张三',
      nickname: '张三',
      phone: '13800000000',
      organization: '智库研究部',
      status: 'ACTIVE',
      createdAt: new Date(),
      roles: [{ role: { code: 'USER' } }],
    };
    const prisma = buildPrisma();
    prisma.user.create = vi.fn().mockResolvedValue(created) as never;
    const svc = new AdminUsersService(prisma as never);
    const res = await svc.create({
      username: 'u1',
      realName: '张三',
      phone: '13800000000',
      organization: '智库研究部',
      role: 'USER',
      password: '123456',
    });
    expect(res.roles).toEqual(['USER']);
    expect(res.organization).toBe('智库研究部');
    expect(prisma.tenant.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: '智库研究部' }) }),
    );
    // 密码被哈希而非明文落库
    expect((prisma.user.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.passwordHash).toContain('hashed:');
  });
});

describe('AdminUsersService.setStatus（禁用/启用）', () => {
  it('禁止禁用自己 → 抛 CONFLICT', async () => {
    const prisma = buildPrisma();
    const svc = new AdminUsersService(prisma as never);
    await expect(
      tenantAls.run({ userId: 'u1', tenantId: 't1', roles: ['PLATFORM_ADMIN'] }, () =>
        svc.setStatus('u1', { status: 'DISABLED' }),
      ),
    ).rejects.toMatchObject({ bizCode: ErrorCode.CONFLICT });
  });

  it('启用其他用户 → 返回新状态', async () => {
    const prisma = buildPrisma();
    prisma.user.findUnique = vi.fn().mockResolvedValue({ id: 'u2' }) as never;
    prisma.user.update = vi.fn().mockResolvedValue({ id: 'u2', status: 'ACTIVE' }) as never;
    const svc = new AdminUsersService(prisma as never);
    await expect(
      tenantAls.run({ userId: 'u1', tenantId: 't1', roles: ['PLATFORM_ADMIN'] }, () =>
        svc.setStatus('u2', { status: 'ACTIVE' }),
      ),
    ).resolves.toEqual({ id: 'u2', status: 'ACTIVE' });
  });
});

describe('AdminUsersService.setRoles（角色绑定）', () => {
  it('移除最后一名平台管理员 → 抛 CONFLICT', async () => {
    const prisma = buildPrisma();
    prisma.user.findUnique = vi.fn().mockResolvedValue({
      id: 'u1',
      roles: [{ role: { code: 'PLATFORM_ADMIN' } }],
    }) as never;
    prisma.userRole.count = vi.fn().mockResolvedValue(1) as never;
    const svc = new AdminUsersService(prisma as never);
    await expect(svc.setRoles('u1', { roles: ['DATA_ADMIN'] })).rejects.toMatchObject({
      bizCode: ErrorCode.CONFLICT,
    });
  });

  it('正常绑定：删除旧角色后写入新角色', async () => {
    const prisma = buildPrisma();
    prisma.user.findUnique = vi.fn().mockResolvedValue({
      id: 'u1',
      roles: [{ role: { code: 'USER' } }],
    }) as never;
    const svc = new AdminUsersService(prisma as never);
    const res = await svc.setRoles('u1', { roles: ['DATA_ADMIN'] });
    expect(res.roles).toEqual(['DATA_ADMIN']);
    expect(prisma.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  it('存在无效角色 → 抛 NOT_FOUND', async () => {
    const prisma = buildPrisma();
    prisma.user.findUnique = vi.fn().mockResolvedValue({
      id: 'u1',
      roles: [{ role: { code: 'USER' } }],
    }) as never;
    prisma.role.findMany = vi.fn().mockResolvedValue([{ id: 'r1', code: 'DATA_ADMIN' }]) as never;
    const svc = new AdminUsersService(prisma as never);
    await expect(svc.setRoles('u1', { roles: ['DATA_ADMIN', 'BAD_ROLE'] })).rejects.toMatchObject({
      bizCode: ErrorCode.NOT_FOUND,
    });
  });
});
