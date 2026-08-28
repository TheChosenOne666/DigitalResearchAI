import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { RoleCode, Roles } from '../../common/auth/roles.decorator';
import { AdminRolesService } from './roles.service';

/**
 * 组织用户 · 角色权限（A-04）：内置三角色 + 权限矩阵。
 * 仅平台管理员可访问（对齐 A-04 权限矩阵）。
 */
@Controller('admin/roles')
@Roles(RoleCode.PLATFORM_ADMIN)
export class AdminRolesController {
  constructor(private readonly roles: AdminRolesService) {}

  /** 角色列表 + 权限矩阵 */
  @Get()
  @HttpCode(HttpStatus.OK)
  listRoles() {
    return this.roles.listRoles();
  }
}
