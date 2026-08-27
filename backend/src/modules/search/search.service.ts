import { Inject, Injectable } from '@nestjs/common';
import type {
  ConnectorInput,
  SearchConnector,
  SearchHit,
  SourceType,
} from './connectors/connector.interface';
import { fuse, type FusionOptions, type FusionResult } from './fusion/fusion.service';

/** 单路检索超时（毫秒），超时熔断不阻塞整体（M2.1 仅垂直/本地，web 为后续预留） */
export const CONNECTOR_TIMEOUT_MS: Record<SourceType, number> = {
  web: 15_000,
  vertical: 10_000,
  local: 3_000,
};

/** 已注册连接器集合的注入令牌 */
export const SEARCH_CONNECTORS = Symbol('SEARCH_CONNECTORS');

/** 外部 abort 触发内部超时控制器 */
function linkAbort(inner: AbortController, outer: AbortSignal): () => void {
  if (outer.aborted) inner.abort();
  const onAbort = () => inner.abort();
  outer.addEventListener('abort', onAbort, { once: true });
  return () => outer.removeEventListener('abort', onAbort);
}

/** abort 事件拒绝的 Promise（用于与连接器竞速） */
function abortRejection(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}

/**
 * 单路检索（带超时 + 外部 AbortSignal 联动）。
 * 超时/出错一律返回 []，不阻断整体管道。纯函数式、可单测。
 */
export async function runConnector(
  conn: SearchConnector,
  input: ConnectorInput,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<SearchHit[]> {
  const inner = new AbortController();
  const timer = setTimeout(() => inner.abort(), timeoutMs);
  const unlink = linkAbort(inner, signal);
  try {
    const result = await Promise.race([conn.search(input, inner.signal), abortRejection(inner.signal)]);
    return result ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
    unlink();
  }
}

/**
 * 智搜编排服务（M2.1 基础管道）：
 * 多路连接器 Promise.allSettled 并发 → 单路熔断 → 汇总命中 → RRF 融合去重截断。
 * 意图分类(M2.2)与 LLM 流式生成(M2.3)不在此服务内。
 */
@Injectable()
export class SearchService {
  constructor(
    @Inject(SEARCH_CONNECTORS) private readonly connectors: SearchConnector[],
  ) {}

  /** 执行检索管道（垂直+本地+M2.2 联网），返回融合结果 */
  async search(
    input: ConnectorInput,
    signal: AbortSignal,
    opts?: FusionOptions,
  ): Promise<FusionResult> {
    const settled = await Promise.allSettled(
      this.connectors.map((c) =>
        runConnector(c, input, signal, CONNECTOR_TIMEOUT_MS[c.sourceType]),
      ),
    );

    const hits: SearchHit[] = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') hits.push(...r.value);
    }
    return fuse(hits, opts);
  }
}
