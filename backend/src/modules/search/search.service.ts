import { Inject, Injectable } from '@nestjs/common';
import type {
  ConnectorInput,
  ConnectorSourceType,
  SearchConnector,
  SearchHit,
  SourceType,
} from './connectors/connector.interface';
import { fuse, type FusionOptions, type FusionResult } from './fusion/fusion.service';
import { withSpan } from '../../common/observability/tracer';

/** 单路检索超时（毫秒），超时熔断不阻塞整体；本地路含问题向量化网络调用（M3.3），预算放宽到 8s */
export const CONNECTOR_TIMEOUT_MS: Record<ConnectorSourceType, number> = {
  web: 15_000,
  vertical: 10_000,
  local: 8_000,
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
 * 汇总 allSettled 结果中的命中（失败路一律忽略，不阻断整体）。
 * @param settled 各路检索结果
 */
function collectHits(settled: PromiseSettledResult<SearchHit[]>[]): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') hits.push(...r.value);
  }
  return hits;
}

/** 知识库优先（串行兜底）判定阈值 */
export interface LocalFirstThresholds {
  /** 命中条数下限 */
  minHits: number;
  /** 最高相似度下限（0~1） */
  minScore: number;
}

/** 阈值默认值（可由环境变量覆盖，见 search.controller） */
export const DEFAULT_LOCAL_FIRST: LocalFirstThresholds = { minHits: 3, minScore: 0.5 };

/** 知识库优先检索结果（附带短路判定依据，供 SSE 提示与线上排查） */
export interface LocalFirstResult extends FusionResult {
  /** 是否短路（知识库命中足够，未发起联网/垂直检索） */
  shortCircuited: boolean;
  /** 本地路命中条数 */
  localHits: number;
  /** 本地路命中最高相似度（0~1） */
  localTopScore: number;
  /** 本次实际执行的检索路 */
  routes: SourceType[];
}

/**
 * 判定知识库命中是否「足够」以短路外网检索（纯函数，可单测）。
 * 两个条件须同时满足：命中**条数**达标 且 最高**相似度**达标——
 * 只看条数会放过一堆弱命中，只看分数会放过孤证。
 * @param hits 本地路命中（rawScore 为该切片跨渠道最高相似度）
 * @param thresholds 阈值（默认 3 条 / 0.5）
 */
export function isLocalEnough(
  hits: SearchHit[],
  thresholds: LocalFirstThresholds = DEFAULT_LOCAL_FIRST,
): boolean {
  if (hits.length < thresholds.minHits) return false;
  const topScore = hits.reduce((max, h) => Math.max(max, h.rawScore ?? 0), 0);
  return topScore >= thresholds.minScore;
}

/**
 * 知识库优先检索（18 智搜增强·混合模式专用）：
 * 先跑本地路 → 命中足够则**短路**（完全不出外网）／不足则补跑联网+垂直 → 合并后统一融合。
 *
 * 与 `search()` 的区别：`search()` 是三路并行，本方法为串行兜底，代价是
 * 兜底路径总耗时 ≈ 本地路耗时 + 外网耗时（短路路径反而更快）。
 *
 * @param input 检索输入
 * @param signal 外部取消信号
 * @param opts 融合选项
 * @param thresholds 短路阈值
 */
export async function searchLocalFirstImpl(
  connectors: SearchConnector[],
  input: ConnectorInput,
  signal: AbortSignal,
  opts?: FusionOptions,
  thresholds: LocalFirstThresholds = DEFAULT_LOCAL_FIRST,
): Promise<LocalFirstResult> {
  // 第一步：只跑本地路
  const localConnectors = connectors.filter((c) => c.sourceType === 'local');
  const localSettled = await withSpan('search.local', {}, async () =>
    Promise.allSettled(
      localConnectors.map((c) => runConnector(c, input, signal, CONNECTOR_TIMEOUT_MS.local)),
    ),
  );
  const localHits = collectHits(localSettled);
  const localTopScore = localHits.reduce((max, h) => Math.max(max, h.rawScore ?? 0), 0);
  const shortCircuited = isLocalEnough(localHits, thresholds);

  // 第二步：命中不足才补外网路；足够则短路，不发起任何外网请求
  let hits = localHits;
  const routes: SourceType[] = ['local'];
  if (!shortCircuited) {
    const external = connectors.filter((c) => c.sourceType !== 'local');
    const settled = await withSpan(
      'search.fetch',
      { 'search.routes': external.map((c) => c.sourceType).join(',') },
      async () =>
        Promise.allSettled(
          external.map((c) => runConnector(c, input, signal, CONNECTOR_TIMEOUT_MS[c.sourceType])),
        ),
    );
    hits = [...localHits, ...collectHits(settled)];
    routes.push(...external.map((c) => c.sourceType));
  }

  const fused = await withSpan('search.fusion', { 'search.hits': hits.length }, async () =>
    fuse(hits, opts),
  );
  return { ...fused, shortCircuited, localHits: localHits.length, localTopScore, routes };
}

/**
 * 智搜编排服务（M2.1 基础管道 / 18 智搜增强）：
 * 多路连接器并发 → 单路熔断 → 汇总命中 → RRF 融合去重截断；
 * 混合模式另提供「知识库优先 + 串行兜底」编排（searchLocalFirst）。
 * 意图分类(M2.2)与 LLM 流式生成(M2.3)不在此服务内。
 */
@Injectable()
export class SearchService {
  constructor(
    @Inject(SEARCH_CONNECTORS) private readonly connectors: SearchConnector[],
  ) {}

  /** 执行检索管道，返回融合结果；routes 缺省跑全部路，传入时仅跑指定来源（三模式路由） */
  async search(
    input: ConnectorInput,
    signal: AbortSignal,
    opts?: FusionOptions,
    routes?: ReadonlySet<SourceType>,
  ): Promise<FusionResult> {
    const connectors = routes ? this.connectors.filter((c) => routes.has(c.sourceType)) : this.connectors;
    const settled = await withSpan('search.fetch', { 'search.routes': [...connectors.map((c) => c.sourceType)].join(',') }, async () =>
      Promise.allSettled(
        connectors.map((c) =>
          runConnector(c, input, signal, CONNECTOR_TIMEOUT_MS[c.sourceType]),
        ),
      ),
    );

    const hits = collectHits(settled);
    return withSpan('search.fusion', { 'search.hits': hits.length }, async () => fuse(hits, opts));
  }

  /**
   * 知识库优先检索（混合模式）：先跑本地路，命中足够则短路不外网／不足才补外网（串行兜底）。
   * @param input 检索输入
   * @param signal 外部取消信号
   * @param opts 融合选项
   * @param thresholds 短路阈值（缺省用 DEFAULT_LOCAL_FIRST）
   */
  searchLocalFirst(
    input: ConnectorInput,
    signal: AbortSignal,
    opts?: FusionOptions,
    thresholds?: LocalFirstThresholds,
  ): Promise<LocalFirstResult> {
    return searchLocalFirstImpl(this.connectors, input, signal, opts, thresholds);
  }
}
