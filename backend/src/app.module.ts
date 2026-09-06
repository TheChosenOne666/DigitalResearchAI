import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './common/config/env.schema';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { ObservabilityModule } from './common/observability/observability.module';
import { requestContextMiddleware } from './common/observability/request-context.middleware';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard';
import { HealthModule } from './common/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { SearchModule } from './modules/search/search.module';
import { KbModule } from './modules/kb/kb.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';
import { ReportModule } from './modules/report/report.module';
import { MemberModule } from './modules/member/member.module';
import { AdminModule } from './modules/admin/admin.module';
import { SessionService } from './common/auth/session.service';
import { RedisSessionStore } from './common/auth/redis-session.store';
import { SessionAuthGuard } from './common/auth/session-auth.guard';
import { RolesGuard } from './common/auth/roles.guard';
import { TenantContextInterceptor } from './common/auth/tenant-context.interceptor';

/**
 * 应用根模块：装配全局配置、观测性（Pino/Prometheus/OTel/Sentry）、
 * 请求上下文中间件（requestId 贯穿 + pino-http 访问日志）、
 * 统一响应拦截器、统一异常过滤器、
 * 会话认证守卫（@Public 跳过）→ 限流守卫（令牌桶，按路由组差异化）→ RBAC 角色守卫（@Roles 校验）→ 租户上下文拦截器。
 */
@Module({
  imports: [
    // 环境变量启动校验（fail-fast）：缺必填项/类型非法时进程启动即失败
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ObservabilityModule,
    RateLimitModule,
    HealthModule,
    AuthModule,
    SearchModule,
    KbModule,
    WorkspaceModule,
    ReportModule,
    MemberModule,
    AdminModule,
  ],
  providers: [
    // 注：MetricsInterceptor 由 ObservabilityModule 内部注册（APP_INTERCEPTOR 为多值
    // token，此处若重复注册会导致同一请求被观测两次、HTTP 指标翻倍），根模块不再声明
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    RedisSessionStore,
    { provide: SessionService, useFactory: (store: RedisSessionStore) => new SessionService(store), inject: [RedisSessionStore] },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestContextMiddleware).forRoutes('*');
  }
}
