import * as Sentry from '@sentry/nestjs';

/**
 * Sentry 初始化（M7.1）：`SENTRY_DSN` 已配置才启用，未配置完全跳过。
 * @returns 是否已初始化
 */
export function initSentry(): boolean {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_RATE ?? '0.1'),
  });
  return true;
}

/** 全局异常过滤器调用：已初始化才上报 */
export function captureIfEnabled(exception: unknown): void {
  if (Sentry.getClient()) {
    Sentry.captureException(exception);
  }
}

/** 是否已初始化（供测试断言） */
export function isSentryEnabled(): boolean {
  return Boolean(Sentry.getClient());
}
