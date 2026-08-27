import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ErrorCode } from '@app/shared';
import { getTenantContext } from '../../../common/auth/tenant-context';
import { BizException } from '../../../common/exceptions/biz.exception';
import type { SearchHit } from '../../search/connectors/connector.interface';
import { reciprocalRankFusion, type RankedGroup } from '../../search/fusion/rrf';
import { KbStoreService } from '../store/kb.store.service';
import { EmbedService } from '../embeddings/embed.service';
import { QdrantService } from '../vector/qdrant.service';

/** 切片摘要截断长度（来源卡 snippet） */
export const LOCAL_SNIPPET_LEN = 160;

/** 本地检索单次返回上限（外层管道融合还会再截 TopK） */
export const LOCAL_MAX_HITS = 20;

/** PG 全文路候选行上限（按命中词数降序取前 N 行后再参与融合） */
export const FULLTEXT_CANDIDATE_LIMIT = 50;

/**
 * 查询分词（纯函数）：ASCII 词 + 中文二元切分。
 * - ASCII：小写化后取连续字母数字词（≥2 字符），如 gdp、2024；
 * - CJK：连续汉字串滑窗切 bigram（如「国内生产总值」→ 国内/内生/生产/总值），
 *   子串包含式匹配对中文无词典分词的可用折中。
 * 返回去重列表（保序，最多 24 个）。
 */
export function extractQueryTerms(question: string): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  const push = (t: string) => {
    if (t.length < 2 || seen.has(t)) return;
    seen.add(t);
    terms.push(t);
  };

  const ascii = question.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const w of ascii) push(w);

  const cjkRuns = question.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const run of cjkRuns) {
    for (let i = 0; i + 2 <= run.length; i++) push(run.slice(i, i + 2));
  }
  return terms.slice(0, 24);
}

/** ILIKE 通配符转义（% _ \），包裹 %..% 供 ANY 匹配 */
export function toIlikePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

/** 生成本地命中的唯一伪链接（兼作外层融合去重键；不作为真实跳转地址） */
export function localHitUrl(
  libraryId: string,
  documentId: string,
  index: number,
): string {
  return `kb://${libraryId}/${documentId}/${index}`;
}

/** 相似度分级（召回测试展示用） */
export type RecallGrade = 'HIGH' | 'MID' | 'LOW';

/** 相似度分级阈值：高 ≥0.7 / 中 ≥0.4 / 低 <0.4 */
export const RECALL_GRADE_HIGH = 0.7;
export const RECALL_GRADE_MID = 0.4;

/** 按相似度打分档（纯函数，供召回测试与单测复用） */
export function gradeSimilarity(score: number): RecallGrade {
  if (score >= RECALL_GRADE_HIGH) return 'HIGH';
  if (score >= RECALL_GRADE_MID) return 'MID';
  return 'LOW';
}

/** 渠道内部切片命中（向量/全文统一中间形态，映射 SearchHit 前使用） */
interface InternalChunk {
  chunkId: string;
  libraryId: string;
  groupId: string | null;
  documentId: string;
  index: number;
  content: string;
  documentName: string;
  /** 该渠道相似度（向量=cosine；全文=命中词占比，均归一 0~1） */
  similarity: number;
}

/**
 * 知识库混合检索服务（M3.3）：
 * 向量路（Qdrant 按租户库 collection 检索）+ 全文路（PG kb_chunks 关键词匹配）
 * → 库级权重 RRF 融合 → 阈值/TopN 截断 → 映射统一 SearchHit。
 * 被 LocalConnector（智搜本地路）与召回测试（M3.4）复用。
 *
 * 打分语义：
 * - 向量相似度 = Qdrant cosine（0~1 钳制）；低于库 threshold 的向量命中在检索期剔除；
 * - 全文相似度 = 命中关键词数 / 提取关键词总数——子串匹配无真实语义距离，
 *   不设库阈值过滤，仅用于排序与分级展示（无 ARK_API_KEY 退化模式下保证全文路可出结果）；
 * - 同一切片多渠道命中时取各渠道最高相似度作为 rawScore；
 * - RRF 组权重 = 所在库的检索权重（kb_libraries.weight），叠加管道层的本地路整体加权，
 *   实现「本地优先」下的库间差异。
 */
@Injectable()
export class KbRetrieverService {
  private readonly logger = new Logger(KbRetrieverService.name);

  constructor(
    private readonly store: KbStoreService,
    private readonly embed: EmbedService,
    private readonly qdrant: QdrantService,
  ) {}

  /** 当前租户（受保护路由由拦截器注入；缺失视为未授权） */
  private requireTenant(): string {
    const ctx = getTenantContext();
    if (!ctx) {
      throw new BizException(ErrorCode.UNAUTHORIZED, '缺少租户上下文', HttpStatus.UNAUTHORIZED);
    }
    return ctx.tenantId;
  }

  /**
   * 执行混合检索，返回统一 SearchHit；单路内部异常仅降级告警不抛出。
   * @param question 用户问题
   * @param signal 外部 AbortSignal（问题向量化请求联动取消）
   * @param opts.libraryId 限定单一库检索（召回测试用）；缺省遍历租户全部库
   */
  async search(
    question: string,
    signal?: AbortSignal,
    opts?: { libraryId?: string },
  ): Promise<SearchHit[]> {
    const tenantId = this.requireTenant();
    if (!question.trim()) return [];
    let libs = await this.store.listLibraryRetrievalConfigs(tenantId);
    if (opts?.libraryId) libs = libs.filter((lib) => lib.id === opts.libraryId);
    if (!libs.length) return [];

    // 两路并发取候选（各自内部吞错降级）
    const [vectorByLib, fulltextRows] = await Promise.all([
      this.vectorChannel(tenantId, libs, question, signal),
      this.fulltextChannel(tenantId, question),
    ]);
    if (!vectorByLib.size && !fulltextRows.length) return [];

    // 库级分组 → RRF 融合（组权重 = 库检索权重）
    const groups: RankedGroup[] = [];
    for (const lib of libs) {
      const v = vectorByLib.get(lib.id) ?? [];
      if (v.length) groups.push({ hits: v.map((c) => this.toSearchHit(c)), weight: lib.weight });
      const f = fulltextRows.filter((c) => c.libraryId === lib.id);
      if (f.length) groups.push({ hits: f.map((c) => this.toSearchHit(c)), weight: lib.weight });
    }
    const fused = reciprocalRankFusion(groups);
    const ranked = [...fused.values()].sort((a, b) => b.score - a.score);

    // 每条切片命中的跨渠道最高相似度 → rawScore
    const simByUrl = new Map<string, number>();
    const collect = (list: InternalChunk[]) => {
      for (const c of list) {
        const url = localHitUrl(c.libraryId, c.documentId, c.index);
        simByUrl.set(url, Math.max(simByUrl.get(url) ?? 0, c.similarity));
      }
    };
    vectorByLib.forEach(collect);
    collect(fulltextRows);

    return ranked.slice(0, LOCAL_MAX_HITS).map((entry) => ({
      ...entry.hit,
      rawScore: Number((simByUrl.get(entry.hit.url ?? '') ?? 0).toFixed(4)),
    }));
  }

  /** 向量路：问题向量化 → 各库 collection 并发检索 → 库阈值过滤。embed 未启用或失败返回空 Map */
  private async vectorChannel(
    tenantId: string,
    libs: Array<{ id: string; topK: number; threshold: number }>,
    question: string,
    signal?: AbortSignal,
  ): Promise<Map<string, InternalChunk[]>> {
    const out = new Map<string, InternalChunk[]>();
    if (!this.embed.enabled || !this.qdrant.isEnabled()) return out;
    try {
      const [questionVec] = await this.embed.embed([question], signal);
      if (!questionVec?.length) return out;
      const existing = new Set(await this.qdrant.listCollectionNames());
      const targets = libs.filter((lib) =>
        existing.has(this.qdrant.collectionName(tenantId, lib.id)),
      );

      const settled = await Promise.allSettled(
        targets.map(async (lib) => {
          const points = await this.qdrant.search(tenantId, lib.id, questionVec, lib.topK);
          const passed = points.filter((p) => p.score >= lib.threshold);
          if (!passed.length) return [];
          const chunks = await this.store.getChunksWithDocNames(
            tenantId,
            passed.map((p) => p.id),
          );
          const byId = new Map(chunks.map((c) => [c.id, c]));
          return passed.flatMap((p) => {
            const row = byId.get(p.id);
            if (!row) return [];
            return [
              {
                chunkId: p.id,
                libraryId: row.libraryId,
                groupId: row.groupId,
                documentId: row.documentId,
                index: row.index,
                content: row.content,
                documentName: row.documentName,
                similarity: Math.min(1, Math.max(0, p.score)),
              } satisfies InternalChunk,
            ];
          });
        }),
      );
      settled.forEach((r, i) => {
        if (r.status === 'rejected') {
          this.logger.warn(`Qdrant 库 ${targets[i].id} 检索失败（忽略该库）：${(r.reason as Error)?.message}`);
          return;
        }
        if (r.value.length) out.set(targets[i].id, r.value);
      });
    } catch (e) {
      this.logger.warn(`问题向量化失败，退纯全文：${(e as Error).message}`);
    }
    return out;
  }

  /** 全文路：查询分词 → PG ILIKE 多关键词匹配，按命中词数排序取候选 */
  private async fulltextChannel(tenantId: string, question: string): Promise<InternalChunk[]> {
    const terms = extractQueryTerms(question);
    if (!terms.length) return [];
    try {
      const rows = await this.store.searchChunksFulltext({
        tenantId,
        patterns: terms.map(toIlikePattern),
        limit: FULLTEXT_CANDIDATE_LIMIT,
      });
      return rows.map((row) => ({
        ...row,
        similarity: row.matchedTerms / terms.length,
      }));
    } catch (e) {
      this.logger.warn(`PG 全文检索失败：${(e as Error).message}`);
      return [];
    }
  }

  /** 渠道切片 → 统一 SearchHit（url 为唯一伪链接，兼作外层融合去重键） */
  private toSearchHit(c: InternalChunk): SearchHit {
    return {
      title: c.documentName,
      snippet: c.content.slice(0, LOCAL_SNIPPET_LEN),
      contentMd: c.content,
      sourceType: 'local',
      meta: { libraryId: c.libraryId, groupId: c.groupId, documentId: c.documentId, idx: c.index },
      url: localHitUrl(c.libraryId, c.documentId, c.index),
    };
  }
}
