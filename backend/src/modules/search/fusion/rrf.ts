import type { SearchHit } from '../connectors/connector.interface';

/** 单路命中分组（含该路权重） */
export interface RankedGroup {
  hits: SearchHit[];
  /** 该路权重（默认 1；本地路加权 1.2） */
  weight?: number;
}

/** 融合后单条（命中 + 融合得分） */
export interface FusedEntry {
  hit: SearchHit;
  score: number;
}

/** 以 sourceType + (url|title) 作为融合去重键 */
export function hitKey(h: SearchHit): string {
  return `${h.sourceType}:${h.url ?? h.title}`;
}

/**
 * 倒数排名融合（Reciprocal Rank Fusion）。
 * score(d) = Σ weight_i / (k + rank_i)，rank 从 1 起。
 * 跨路同一键的得分累加。纯函数，便于单测。
 */
export function reciprocalRankFusion(
  groups: RankedGroup[],
  k = 60,
): Map<string, FusedEntry> {
  const map = new Map<string, FusedEntry>();
  for (const g of groups) {
    const weight = g.weight ?? 1;
    g.hits.forEach((hit, i) => {
      const key = hitKey(hit);
      const rank = i + 1;
      const add = weight / (k + rank);
      const existing = map.get(key);
      if (existing) {
        existing.score += add;
      } else {
        map.set(key, { hit, score: add });
      }
    });
  }
  return map;
}
