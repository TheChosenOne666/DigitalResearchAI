import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@app/shared';
import { BizException } from '../exceptions/biz.exception';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ROLES_KEY } from './roles.decorator';

/**
 * RBAC 角色守卫：读取 @Roles 声明的所需角色，校验当前用户角色（任一满足即可）。
 * 需与 SessionAuthGuard 配合（全局守卫先认证后授权），路由未声明 @Roles 时仅要求已登录。
 */
@Injectable()
export class RolesGuard {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 公开路由直接放行（认证守卫已跳过）
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // 未声明 @Roles：仅要求登录（认证守卫已保证）
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: { roles?: string[] } }>();
    const userRoles = request.user?.roles ?? [];
    const allowed = required.some((role) => userRoles.includes(role));
    if (!allowed) {
      throw new BizException(ErrorCode.FORBIDDEN, '无权限访问该资源', 403);
    }
    return true;
  }
}
