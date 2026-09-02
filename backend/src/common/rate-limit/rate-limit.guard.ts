import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RateLimitService } from './rate-limit.service';

/** 请求上可用的最小形状（路由模板 + 客户端 IP + 会话用户上下文） */
interface RateLimitRequest {
  path?: string;
  ip?: string;
  route?: { path?: string };
  user?: { userId?: string };
}

/** 基础设施端点（健康检查 / Prometheus 抓取），不纳入限流 */
const EXEMPT_PATHS = new Set(['/health', '/metrics']);

/**
 * 全局限流守卫（M7.2）：按路由组差异化阈值。
 * 注册在 SessionAuthGuard 之后——已登录路由可用 req.user 按用户维度限流，
 * @Public 的登录/验证码路由则按 IP 维度（最严）。
 * 路由组：/auth*（IP 令牌桶，最严）｜/search/stream（跳过，SSE 并发由 controller 管理）｜其余（用户/匿名 IP 令牌桶，宽松）。
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimit: RateLimitService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 总开关：RATE_LIMIT_ENABLED=false 时整体关闭（压测/联调按需绕过）
    if (this.config.get<string>('RATE_LIMIT_ENABLED', 'true') === 'false') {
      return true;
    }

    const req = context.switchToHttp().getRequest<RateLimitRequest>();
    const path = req.route?.path ?? req.path ?? '';
    const ip = req.ip ?? 'unknown';

    if (EXEMPT_PATHS.has(path)) return true;
    if (path.startsWith('/auth')) {
      await this.rateLimit.checkAuth(ip);
      return true;
    }
    if (path === '/search/stream') return true;

    await this.rateLimit.checkGlobal(req.user?.userId ?? null, ip);
    return true;
  }
}
