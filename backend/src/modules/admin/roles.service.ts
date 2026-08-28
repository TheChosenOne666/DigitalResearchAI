import { Injectable } from '@nestjs/common';
import { BUILTIN_ROLES, PERMISSION_MATRIX } from './constants';

/**
 * 组织用户 · 角色权限服务（A-04）。
 * 三角色为系统内置（一期不开放自定义角色），权限矩阵由静态常量推导，无需查库（D4）。
 */
@Injectable()
export class AdminRolesService {
  /** 角色列表 + 权限矩阵（静态常量） */
  listRoles() {
    return {
      roles: BUILTIN_ROLES,
      matrix: PERMISSION_MATRIX,
    };
  }
}
