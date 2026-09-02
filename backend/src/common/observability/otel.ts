import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { appLogger } from './app-logger';

/** OTLP 导出端点默认值（docker-compose jaeger） */
const DEFAULT_OTLP_ENDPOINT = 'http://localhost:4318/v1/traces';

let started = false;

/**
 * 启动 OTel 链路追踪（M7.1）：OTLP HTTP 导出到 Jaeger。
 * `OTEL_ENABLED!=='true'` 时完全不初始化——trace.getTracer 返回 no-op，
 * 管道 span 调用零开销（沿用项目"未配置即关闭"降级风格）。
 */
export function startOtel(): void {
  if (started || process.env.OTEL_ENABLED !== 'true') return;
  started = true;

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'ai-research-api',
      [ATTR_SERVICE_VERSION]: '0.1.0',
    }),
    traceExporter: new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? DEFAULT_OTLP_ENDPOINT,
    }),
  });
  sdk.start();

  const shutdown = (): void => {
    void sdk.shutdown();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  appLogger.pino.info(
    { url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? DEFAULT_OTLP_ENDPOINT },
    'OTel 链路追踪已启用',
  );
}

/** 是否已启用（供测试断言） */
export function isOtelStarted(): boolean {
  return started;
}
