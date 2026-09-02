import { describe, expect, it } from 'vitest';
import { of } from 'rxjs';
import { EventEmitter } from 'node:events';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { newRequestId, getRequestId, runWithRequestId } from '../src/common/observability/request-context';
import { requestContextMiddleware } from '../src/common/observability/request-context.middleware';
import { MetricsService } from '../src/common/observability/metrics.service';
import { MetricsInterceptor } from '../src/common/observability/metrics.interceptor';
import { initSentry, isSentryEnabled } from '../src/common/observability/sentry';
import { startOtel, isOtelStarted } from '../src/common/observability/otel';

/** 构造不触发真实 Redis 连接的 MetricsService（不调 onModuleInit） */
function createMetrics(): MetricsService {
  const config = { get: (_key: string, def?: string) => def } as never;
  return new MetricsService(config);
}

/**
 * 构造最小可用的 mock Response：pino-http 会订阅 res 的 finish/close 事件，
 * 因此必须带 EventEmitter 能力，仅有 setHeader 会在中间件内抛 res.on is not a function。
 */
function mockRes(headers: Record<string, string>): never {
  const res = new EventEmitter() as unknown as { setHeader: (k: string, v: string) => void };
  res.setHeader = (k: string, v: string) => {
    headers[k] = v;
  };
  return res as never;
}

describe('M7.1 request-context', () => {
  it('newRequestId 生成 req- 前缀且不重复', () => {
    const a = newRequestId();
    const b = newRequestId();
    expect(a).toMatch(/^req-[0-9a-z]+-[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
  });

  it('ALS 上下文贯穿异步调用链', async () => {
    const id = newRequestId();
    const seen = await runWithRequestId(id, async () => {
      await Promise.resolve();
      return getRequestId();
    });
    expect(seen).toBe(id);
    expect(getRequestId()).toBeUndefined();
  });

  it('中间件：透传上游 X-Request-Id 并建立 ALS 上下文', () => {
    const headers: Record<string, string> = { 'x-request-id': 'upstream-123' };
    let insideId: string | undefined;
    requestContextMiddleware(
      { headers } as never,
      mockRes(headers),
      () => {
        insideId = getRequestId();
      },
    );
    expect(insideId).toBe('upstream-123');
    expect(headers['x-request-id']).toBe('upstream-123');
  });

  it('中间件：无上游头时生成新 requestId', () => {
    let insideId: string | undefined;
    const set: Record<string, string> = {};
    requestContextMiddleware(
      { headers: {} } as never,
      mockRes(set),
      () => {
        insideId = getRequestId();
      },
    );
    expect(insideId).toMatch(/^req-/);
    expect(set['x-request-id']).toBe(insideId);
  });
});

describe('M7.1 metrics', () => {
  it('HTTP/SSE/LLM 埋点后在 /metrics 文本中可见', async () => {
    const metrics = createMetrics();
    metrics.observeHttp('/search/stream', 'GET', 200, 0.42);
    metrics.sseOpen();
    metrics.sseOpen();
    metrics.sseClose(true);
    metrics.llmCall('intent', 'ok');
    metrics.llmCall('intent', 'error');
    const text = await metrics.text();
    expect(text).toContain('http_request_duration_seconds');
    expect(text).toContain('sse_active_connections 1');
    expect(text).toContain('sse_disconnects_total 1');
    expect(text).toContain('llm_calls_total{scene="intent",status="ok"} 1');
    expect(text).toContain('llm_calls_total{scene="intent",status="error"} 1');
  });

  it('MetricsInterceptor 记录路由模板与时延', async () => {
    const metrics = createMetrics();
    const interceptor = new MetricsInterceptor(metrics);
    const req = { method: 'GET', path: '/users/abc', route: { path: '/users/:id' }, baseUrl: '' };
    const res = { statusCode: 200 };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ExecutionContext;
    const handler: CallHandler = { handle: () => of('ok') };
    await new Promise<void>((resolve) => {
      interceptor.intercept(ctx, handler).subscribe(() => resolve());
    });
    const text = await metrics.text();
    expect(text).toContain('http_request_duration_seconds_count{method="GET",route="/users/:id",status="200"} 1');
  });

  it('contentType 为 Prometheus 文本格式', () => {
    const metrics = createMetrics();
    expect(metrics.contentType).toContain('text/plain');
  });
});

describe('M7.1 降级开关', () => {
  it('未配置 SENTRY_DSN：initSentry 返回 false 且不初始化', () => {
    delete process.env.SENTRY_DSN;
    expect(initSentry()).toBe(false);
    expect(isSentryEnabled()).toBe(false);
  });

  it('未开启 OTEL_ENABLED：startOtel 为 no-op', () => {
    delete process.env.OTEL_ENABLED;
    startOtel();
    expect(isOtelStarted()).toBe(false);
  });
});
