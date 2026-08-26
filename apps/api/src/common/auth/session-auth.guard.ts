import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ErrorCode } from '@app/shared';
import { BizException } from '../exceptions/biz.exception';
import { SessionService, SessionContext } from './session.service';

/** 请求上的认证上下文（守卫校验通过后挂载） */
export interface AuthContext extends SessionContext {}

/** 自定义请求接口：携带认证上下文 */
export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
  user?: AuthContext;
}

/**
 * 会话认证守卫：校验 Authorization: Bearer <sessionId>（Redis session 滑动续期）；
 * SSE 场景支持 ?sessionId= query 兜底（EventSource 无法自定义 header）。
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(protected readonly sessionService: SessionService) {}

  /** 从 header / query 提取 sessionId */
  protected extractSessionId(request: AuthenticatedRequest): string | null {
    const header = request.headers?.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      const sid = header.slice('Bearer '.length);
      if (sid.length > 0) return sid;
    }
    const querySid = request.query?.sessionId;
    if (typeof querySid === 'string' && querySid.length > 0) {
      return querySid;
    }
    return null;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const sessionId = this.extractSessionId(request);
    if (!sessionId) {
      throw new BizException(ErrorCode.UNAUTHORIZED, '未登录', 401);
    }
    const sessionContext = await this.sessionService.resolveSession(sessionId);
    if (!sessionContext) {
      throw new BizException(ErrorCode.INVALID_SESSION, '会话无效或已过期', 401);
    }
    request.user = sessionContext;
    return true;
  }
}
