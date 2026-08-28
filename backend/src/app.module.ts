import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { HealthModule } from './common/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { SearchModule } from './modules/search/search.module';
import { KbModule } from './modules/kb/kb.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';
import { ReportModule } from './modules/report/report.module';
import { SessionService } from './common/auth/session.service';
import { RedisSessionStore } from './common/auth/redis-session.store';
import { SessionAuthGuard } from './common/auth/session-auth.guard';
import { RolesGuard } from './common/auth/roles.guard';
import { TenantContextInterceptor } from './common/auth/tenant-context.interceptor';

/**
 * 应用根模块：装配全局配置、统一响应拦截器、统一异常过滤器、
 * 会话认证守卫（@Public 跳过）→ RBAC 角色守卫（@Roles 校验）→ 租户上下文拦截器。
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), HealthModule, AuthModule, SearchModule, KbModule, WorkspaceModule, ReportModule],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    RedisSessionStore,
    { provide: SessionService, useFactory: (store: RedisSessionStore) => new SessionService(store), inject: [RedisSessionStore] },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}
