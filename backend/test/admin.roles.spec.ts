import { describe, expect, it } from 'vitest';
import { AdminRolesService } from '../src/modules/admin/roles.service';
import { BUILTIN_ROLES, PERMISSION_MATRIX } from '../src/modules/admin/constants';

describe('AdminRolesService.listRoles（A-04 角色权限）', () => {
  it('返回 3 个内置角色 + 4 行权限矩阵', () => {
    const svc = new AdminRolesService();
    const result = svc.listRoles();
    expect(result.roles).toHaveLength(3);
    expect(result.roles.map((r) => r.code)).toEqual(['PLATFORM_ADMIN', 'DATA_ADMIN', 'USER']);
    expect(result.matrix).toHaveLength(4);
  });

  it('权限矩阵：组织用户/运营管理仅平台管理员可见', () => {
    const row = PERMISSION_MATRIX.find((r) => r.module.includes('组织用户'));
    expect(row).toBeDefined();
    expect(row!.PLATFORM_ADMIN).toBe(true);
    expect(row!.DATA_ADMIN).toBe(false);
    expect(row!.USER).toBe(false);
  });

  it('权限矩阵：数据资源对数据管理员开放、对普通用户关闭', () => {
    const row = PERMISSION_MATRIX.find((r) => r.module.includes('数据资源'));
    expect(row!.DATA_ADMIN).toBe(true);
    expect(row!.USER).toBe(false);
  });

  it('内置角色说明非空', () => {
    for (const r of BUILTIN_ROLES) {
      expect(r.name).toBeTruthy();
      expect(r.description).toBeTruthy();
    }
  });
});
