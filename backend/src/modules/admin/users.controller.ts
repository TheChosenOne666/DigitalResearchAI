import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { RoleCode, Roles } from '../../common/auth/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminUsersService } from './users.service';
import { AdminAuditService } from './admin-audit.service';
import {
  AdminUserCreateSchema,
  AdminUserUpdateSchema,
  AdminUserStatusSchema,
  AdminResetPasswordSchema,
  AdminUserRolesSchema,
} from './dto';
import type {
  AdminUserCreate,
  AdminUserUpdate,
  AdminUserStatus,
  AdminResetPassword,
  AdminUserRoles,
} from './dto';

/**
 * 组织用户 · 用户管理（A-02）：用户列表 / 新增 / 编辑 / 禁用 / 重置密码 / 角色绑定。
 * 仅平台管理员可访问（对齐 A-04 权限矩阵）。
 */
@Controller('admin/users')
@Roles(RoleCode.PLATFORM_ADMIN)
export class AdminUsersController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly audit: AdminAuditService,
  ) {}

  /** 用户列表（关键词/角色/状态筛选 + 分页） */
  @Get()
  @HttpCode(HttpStatus.OK)
  list(
    @Query('keyword') keyword?: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.users.list({
      keyword,
      role,
      status,
      page: Number(page) || 1,
      pageSize: Number(pageSize),
    });
  }

  /** 新增用户 */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body(new ZodValidationPipe(AdminUserCreateSchema)) body: AdminUserCreate) {
    const user = await this.users.create(body);
    await this.audit.record({ targetType: 'USER', targetId: user.id, detail: { username: user.username } });
    return user;
  }

  /** 编辑用户（不含密码与角色） */
  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminUserUpdateSchema)) body: AdminUserUpdate,
  ) {
    const user = await this.users.update(id, body);
    await this.audit.record({ targetType: 'USER', targetId: id, detail: { username: user.username } });
    return user;
  }

  /** 禁用/启用（禁止禁用自己） */
  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  async setStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminUserStatusSchema)) body: AdminUserStatus,
  ) {
    const result = await this.users.setStatus(id, body);
    await this.audit.record({ targetType: 'USER', targetId: id, detail: { status: result.status } });
    return result;
  }

  /** 重置密码（写站内信通知用户） */
  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminResetPasswordSchema)) body: AdminResetPassword,
  ) {
    const result = await this.users.resetPassword(id, body);
    await this.audit.record({ targetType: 'USER', targetId: id, detail: { action: 'reset-password' } });
    return result;
  }

  /** 角色绑定（平台管理员至少保留 1 名） */
  @Patch(':id/roles')
  @HttpCode(HttpStatus.OK)
  async setRoles(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminUserRolesSchema)) body: AdminUserRoles,
  ) {
    const result = await this.users.setRoles(id, body);
    await this.audit.record({ targetType: 'USER', targetId: id, detail: { roles: result.roles } });
    return result;
  }
}
