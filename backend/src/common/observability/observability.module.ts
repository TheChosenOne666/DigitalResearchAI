import { Global, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppLogger } from './app-logger';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { MetricsInterceptor } from './metrics.interceptor';
import { startOtel } from './otel';

/**
 * 观测性模块（M7.1，全局）：
 * Pino 日志（AppLogger）+ Prometheus 指标（MetricsService/Controller/Interceptor）；
 * OTel 在 onApplicationBootstrap 启动（OTEL_ENABLED 未开启则 no-op）。
 *
 * @Global：Search/Report 等各业务模块直接注入 MetricsService、AppLogger，
 * 无需逐个 import 本模块；MetricsService 全局单例保证指标 registry 唯一。
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    AppLogger,
    MetricsService,
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
  exports: [AppLogger, MetricsService],
})
export class ObservabilityModule implements OnApplicationBootstrap {
  onApplicationBootstrap(): void {
    startOtel();
  }
}
