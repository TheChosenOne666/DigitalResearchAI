import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ConnectorInput,
  SearchConnector,
  SearchConditions,
  SearchHit,
  SourceType,
} from './connector.interface';

/** AnySearch 搜索基地址 */
const ANYSEARCH_BASE = 'https://api.anysearch.com/v1/search';
/** 单次搜索返回条数 */
const SEARCH_COUNT = 10;

/** AnySearch 单条结果 */
export interface AnySearchResult {
  title?: string;
  url?: string;
  snippet?: string;
  /** 正文内容（AnySearch 已清洗，无需自行抓取） */
  content?: string;
  /** 来源站点名（可选） */
  siteName?: string;
  /** 平台附加元数据（request_id / total_results / search_time_ms 等） */
  metadata?: Record<string, unknown>;
}

/**
 * 构建联网路搜索词（纯函数，便于单测）：问题优先，
 * 把问题中未出现的条件（国家/指标/年份区间）拼装在尾部，提升条件回填对联网路的约束力。
 */
export function buildWebQuery(input: ConnectorInput): string {
  const q = input.question?.trim() ?? '';
  const c: SearchConditions = input.conditions ?? {};
  const parts: string[] = [];
  for (const t of [...(c.countries ?? []), ...(c.indicators ?? [])]) {
    const token = t?.trim();
    if (token && !q.includes(token)) parts.push(token);
  }
  if (c.yearFrom != null && c.yearTo != null) {
    const mentioned = q.includes(String(c.yearFrom)) || q.includes(String(c.yearTo));
    if (!mentioned) parts.push(`${c.yearFrom}-${c.yearTo}`);
  }
  return [q, ...parts].filter(Boolean).join(' ');
}

/**
 * 从 AnySearch 响应 JSON 提取结果列表（纯函数，便于单测）。
 * 实际响应结构：{ code, message, request_id, data: { results: [], metadata: {} } }，
 * 结果挂载在 data.results 下；code !== 0 视为调用失败返回空数组。
 */
export function parseAnySearchResponse(json: unknown): AnySearchResult[] {
  if (!json || typeof json !== 'object') return [];
  const obj = json as Record<string, unknown>;
  if (typeof obj.code === 'number' && obj.code !== 0) return [];
  const data = obj.data;
  if (!data || typeof data !== 'object') return [];
  const results = (data as Record<string, unknown>).results;
  if (!Array.isArray(results)) return [];
  return results.filter(
    (r): r is AnySearchResult => !!r && typeof (r as AnySearchResult).url === 'string',
  );
}

/**
 * 联网路连接器（M2.2）：直连 AnySearch 聚合搜索。
 * - AnySearch 直接返回结构化结果（含正文 content），无需自行抓取与清洗。
 * - 支持两种模式：认证模式（携带 Bearer Key，更高配额）/ 匿名模式（不传 Key，按客户端 IP 限流）。
 * - 请求失败：返回空数组 + 警告（不让假数据污染管道），不抛出阻断整体。
 */
@Injectable()
export class WebAnySearchConnector implements SearchConnector {
  readonly sourceType: SourceType = 'web';
  private readonly logger = new Logger(WebAnySearchConnector.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('ANYSEARCH_API_KEY') ?? '';
    this.baseUrl = config.get<string>('ANYSEARCH_BASE_URL') ?? ANYSEARCH_BASE;
    if (!this.apiKey) {
      this.logger.warn('ANYSEARCH_API_KEY 未配置，联网路将以匿名模式调用（按 IP 限流，额度较低）');
    }
  }

  async search(input: ConnectorInput, signal: AbortSignal): Promise<SearchHit[]> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    let results: AnySearchResult[] = [];
    try {
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        signal,
        headers,
        body: JSON.stringify({
          query: buildWebQuery(input),
          max_results: SEARCH_COUNT,
        }),
      });
      if (!res.ok) throw new Error(`AnySearch HTTP ${res.status}`);
      results = parseAnySearchResponse(await res.json());
    } catch (e) {
      this.logger.warn(`AnySearch 搜索失败，联网路跳过：${e instanceof Error ? e.message : e}`);
      return [];
    }

    return results
      .filter((r): r is AnySearchResult => !!r.url)
      .map((r) => ({
        title: r.title ?? r.url ?? '',
        url: r.url,
        snippet: r.snippet ?? '',
        contentMd: r.content ?? '',
        sourceType: 'web' as SourceType,
        meta: {
          siteName: r.siteName,
          ...(r.metadata ?? {}),
        },
      }));
  }
}
