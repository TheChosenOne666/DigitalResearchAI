import { describe, expect, it } from 'vitest';
import { filterAdminMenus, ADMIN_MENUS } from '../src/modules/admin/constants';
import { MeController } from '../src/modules/admin/me.controller';
import { tenantAls } from '../src/common/auth/tenant-context';
import { ErrorCode } from '@app/shared';

describe('ADMIN_MENUS 结构', () => {
  it('共 9 个分组、20 个菜单项', () => {
    expect(ADMIN_MENUS).toHaveLength(9);
    expect(ADMIN_MENUS.reduce((n, g) => n + g.items.length, 0)).toBe(20);
  });
});

describe('filterAdminMenus（角色过滤 + 空组剔除）', () => {
  it('普通用户：无任何可见菜单', () => {
    expect(filterAdminMenus(['USER'])).toEqual([]);
  });

  it('数据管理员：仅数据资源 / 数据治理 / 任务中心 / 运营看板', () => {
    const groups = filterAdminMenus(['DATA_ADMIN']);
    expect(groups.map((g) => g.key)).toEqual(['dashboard', 'data', 'governance', 'tasks']);
    // 组织用户 / 运营管理 / 系统管理 / 知识库管理 / 支付中心 全部不可见
    expect(groups.some((g) => g.key === 'org')).toBe(false);
    expect(groups.some((g) => g.key === 'system')).toBe(false);
    expect(groups.some((g) => g.key === 'pay')).toBe(false);
  });

  it('平台管理员：9 组全可见', () => {
    const groups = filterAdminMenus(['PLATFORM_ADMIN']);
    expect(groups).toHaveLength(9);
    expect(groups.map((g) => g.key)).toEqual([
      'dashboard',
      'org',
      'data',
      'governance',
      'ops',
      'tasks',
      'system',
      'kb',
      'pay',
    ]);
  });

  it('多角色并集：PLATFORM_ADMIN + DATA_ADMIN 取平台管理员全集', () => {
    expect(filterAdminMenus(['DATA_ADMIN', 'PLATFORM_ADMIN'])).toHaveLength(9);
  });
});

describe('MeController.me（当前管理员上下文）', () => {
  function buildPrisma() {
    return {
      user: {
        findUnique: () =>
          Promise.resolve({
            id: 'u1',
            nickname: '平台管理员',
            phone: '13800000000',
            tenant: { name: '平台管理空间' },
          }),
      },
    } as never;
  }

  it('平台管理员：返回用户 + 角色 + 可见菜单（9 组）', async () => {
    const ctrl = new MeController(buildPrisma());
    const result = await tenantAls.run(
      { userId: 'u1', tenantId: 't1', roles: ['PLATFORM_ADMIN'] },
      () => ctrl.me(),
    );
    expect(result.user).toEqual({
      id: 'u1',
      nickname: '平台管理员',
      phone: '13800000000',
      tenantId: 't1',
      tenantName: '平台管理空间',
    });
    expect(result.roles).toEqual(['PLATFORM_ADMIN']);
    expect(result.menus).toHaveLength(9);
  });

  it('数据管理员：菜单仅 4 组', async () => {
    const ctrl = new MeController(buildPrisma());
    const result = await tenantAls.run(
      { userId: 'u1', tenantId: 't1', roles: ['DATA_ADMIN'] },
      () => ctrl.me(),
    );
    expect(result.menus.map((g) => g.key)).toEqual(['dashboard', 'data', 'governance', 'tasks']);
  });

  it('无请求上下文：抛出未登录（1001）', async () => {
    const ctrl = new MeController(buildPrisma());
    await expect(ctrl.me()).rejects.toMatchObject({ bizCode: ErrorCode.UNAUTHORIZED });
  });
});
