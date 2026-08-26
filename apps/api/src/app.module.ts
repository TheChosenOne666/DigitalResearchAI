import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { HealthModule } from './common/health/health.module';
import { AuthModule } from './modules/auth/auth.module';

/**
 * 应用根模块：装配全局配置、统一响应拦截器、统一异常过滤器与业务模块。
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), HealthModule, AuthModule],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
