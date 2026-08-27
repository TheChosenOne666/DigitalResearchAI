import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tenantAls } from './tenant-context';
import type { AuthenticatedRequest } from './session-auth.guard';

/**
 * 租户上下文拦截器：在守卫之后、业务处理之前，
 * 把会话上的用户/租户/角色写入 AsyncLocalStorage，供 Prisma 租户 Extension 读取。
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (user?.tenantId) {
      return tenantAls.run(
        { userId: user.userId, tenantId: user.tenantId, roles: user.roles },
        () => next.handle(),
      );
    }
    return next.handle();
  }
}
