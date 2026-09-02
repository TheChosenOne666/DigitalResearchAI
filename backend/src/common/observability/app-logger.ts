import { LoggerService } from '@nestjs/common';
import pino from 'pino';
import { getRequestId } from './request-context';

/**
 * 全局 Pino 日志器：
 * - JSON 单行输出（LOG_PRETTY=true 时走 pino-pretty，仅开发用）；
 * - mixin 自动附带 ALS 中的 requestId，HTTP 请求与 worker 日志全程贯穿；
 * - 同时实现 Nest LoggerService，`app.useLogger` 后框架与各 Service 的
 *   `new Logger(...)` 日志统一路由到 Pino 结构化输出。
 */
class AppLoggerImpl implements LoggerService {
  readonly pino: pino.Logger;

  constructor() {
    this.pino = pino({
      level: process.env.LOG_LEVEL ?? 'info',
      mixin: () => {
        const requestId = getRequestId();
        return requestId ? { requestId } : {};
      },
      redact: {
        paths: ['authorization', 'cookie', '*.password', 'password'],
        censor: '[REDACTED]',
      },
      ...(process.env.LOG_PRETTY === 'true'
        ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
        : {}),
    });
  }

  log(message: unknown, context?: string): void {
    this.pino.info({ ctx: context }, String(message));
  }

  error(message: unknown, stack?: string, context?: string): void {
    this.pino.error({ ctx: context, stack }, String(message));
  }

  warn(message: unknown, context?: string): void {
    this.pino.warn({ ctx: context }, String(message));
  }

  debug(message: unknown, context?: string): void {
    this.pino.debug({ ctx: context }, String(message));
  }

  verbose(message: unknown, context?: string): void {
    this.pino.trace({ ctx: context }, String(message));
  }

  fatal(message: unknown, context?: string): void {
    this.pino.fatal({ ctx: context }, String(message));
  }
}

/** 模块级单例（供中间件与 useLogger 共用，避免双实例） */
export const appLogger = new AppLoggerImpl();

/** Nest Provider 包装类 */
export class AppLogger extends AppLoggerImpl {}
