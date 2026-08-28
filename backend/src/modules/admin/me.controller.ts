import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { getTenantContext } from '../../common/auth/tenant-context';
import { RoleCode, Roles } from '../../common/auth/roles.decorator';
import { BizException } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ErrorCode } from '@app/shared';
import { filterAdminMenus } from './constants';

/** 管理端当前用户上下文 */
export interface AdminMeResult {
  user: {
    id: string;
    nickname: string;
    phone: string;
    tenantId: string;
    tenantName: string;
  };
  /** 当前角色编码列表 */
  roles: string[];
  /** 按角色过滤后的可见菜单（前端侧栏按此渲染，后端这份用于校验） */
  menus: ReturnType<typeof filterAdminMenus>;
}

/**
 * 管理端当前用户上下文（M6.1）：登录后前端先调本接口拿角色与菜单，
 * 非管理员（无 PLATFORM_ADMIN / DATA_ADMIN）由 RolesGuard 直接 403。
 */
@Controller('admin')
@Roles(RoleCode.PLATFORM_ADMIN, RoleCode.DATA_ADMIN)
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  /** 当前管理员信息 + 可见菜单 */
  @Get('me')
  @HttpCode(HttpStatus.OK)
  async me(): Promise<AdminMeResult> {
    const ctx = getTenantContext();
    if (!ctx) {
      throw new BizException(ErrorCode.UNAUTHORIZED, '未登录', HttpStatus.UNAUTHORIZED);
    }
    const user = await this.prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { id: true, nickname: true, phone: true, tenant: { select: { name: true } } },
    });
    if (!user) {
      throw new BizException(ErrorCode.UNAUTHORIZED, '用户不存在', HttpStatus.UNAUTHORIZED);
    }
    return {
      user: {
        id: user.id,
        nickname: user.nickname,
        phone: user.phone,
        tenantId: ctx.tenantId,
        tenantName: user.tenant?.name ?? '',
      },
      roles: ctx.roles,
      menus: filterAdminMenus(ctx.roles),
    };
  }
}
