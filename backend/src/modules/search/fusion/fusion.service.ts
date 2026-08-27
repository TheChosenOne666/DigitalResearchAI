import type { SearchHit } from '../connectors/connector.interface';
import { reciprocalRankFusion, type FusedEntry } from './rrf';
import { dedupeBySimHash } from './simhash';

/** 融合选项（库级可配） */
export interface FusionOptions {
  /** 截断条数（默认 10） */
  topK?: number;
  /** 引用级条数（进 Agent 上下文，默认 6） */
  citeCount?: number;
  /** 本地路加权（默认 1.2） */
  localWeight?: number;
}

/** 融合结果 */
export interface FusionResult {
  /** 引用级（进 Agent 上下文 + 来源卡） */
  cited: SearchHit[];
  /** 参考级（仅来源卡展示） */
  referenced: SearchHit[];
  /** 融合后全量（降序，含得分） */
  ranked: FusedEntry[];
}

/**
 * 三路融合（rerank 降级版）：
 * RRF 加权 → SimHash 去重 → 降序截断 TopK → 分引用/参考级。
 * 纯函数，便于单测。
 */
export function fuse(hits: SearchHit[], opts: FusionOptions = {}): FusionResult {
  const { topK = 10, citeCount = 6, localWeight = 1.2 } = opts;

  // 1. 按来源类型分组（本地路加权）
  const groups = [
    { hits: hits.filter((h) => h.sourceType === 'web'), weight: 1 },
    { hits: hits.filter((h) => h.sourceType === 'vertical'), weight: 1 },
    { hits: hits.filter((h) => h.sourceType === 'local'), weight: localWeight },
  ];

  // 2. RRF 融合
  const map = reciprocalRankFusion(groups);

  // 3. 转数组 + SimHash 去重（以 contentMd 或 标题+摘要 为指纹文本）
  const arr: { item: FusedEntry; text: string; score: number }[] = [...map.values()].map(
    (e) => ({
      item: e,
      text: e.hit.contentMd ?? `${e.hit.title}\n${e.hit.snippet}`,
      score: e.score,
    }),
  );
  const deduped = dedupeBySimHash(arr);

  // 4. 降序
  deduped.sort((a, b) => b.score - a.score);

  // 5. 截断 TopK + 分引用/参考级
  const top = deduped.slice(0, topK);
  const cited = top.slice(0, citeCount).map((e) => e.hit);
  const referenced = top.slice(citeCount).map((e) => e.hit);
  return { cited, referenced, ranked: top };
}
