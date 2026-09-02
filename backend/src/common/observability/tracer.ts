import { trace, SpanStatusCode, type Span, type SpanOptions } from '@opentelemetry/api';

/** 平台链路追踪器（OTel 未启用时为 no-op proxy，零开销） */
export const tracer = trace.getTracer('ai-research-api');

/**
 * 在活动 span 内执行异步函数：
 * 成功正常 end；异常记录 exception + ERROR 状态后 rethrow。
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>,
  options?: SpanOptions,
): Promise<T> {
  return tracer.startActiveSpan(name, { ...options, attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (e) {
      span.recordException(e as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (e as Error)?.message });
      throw e;
    } finally {
      span.end();
    }
  });
}
