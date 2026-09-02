import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppLogger } from './common/observability/app-logger';
import { initSentry } from './common/observability/sentry';

/**
 * 应用启动入口：注册全局前缀 /api/v1 与 CORS；
 * Sentry（SENTRY_DSN 未配置即跳过）与 Pino 全局日志（requestId 贯穿）在此接线。
 */
async function bootstrap(): Promise<void> {
  const sentryEnabled = initSentry();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(AppLogger));
  app.setGlobalPrefix('api/v1');
  // 开发阶段放开通源，生产由网关统一管控
  app.enableCors({ origin: true, credentials: true });
  const port = Number(process.env.APP_PORT ?? 3000);
  await app.listen(port);
  new Logger('Bootstrap').log(
    `API 已启动: http://localhost:${port}/api/v1/health${sentryEnabled ? '（Sentry 已启用）' : ''}`,
  );
}

void bootstrap();
