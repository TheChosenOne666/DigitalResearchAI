import { describe, it, expect } from 'vitest';
import { reciprocalRankFusion, hitKey, type RankedGroup } from '../src/modules/search/fusion/rrf';
import type { SearchHit } from '../src/modules/search/connectors/connector.interface';

function hit(url: string, sourceType: SearchHit['sourceType'] = 'web'): SearchHit {
  return { title: url, url, snippet: '', sourceType };
}

describe('reciprocalRankFusion', () => {
  it('k 默认 60，单路 rank1/rank2 得分为 1/61、1/62', () => {
    const map = reciprocalRankFusion([{ hits: [hit('a'), hit('b')] }]);
    expect(map.get('web:a')!.score).toBeCloseTo(1 / 61);
    expect(map.get('web:b')!.score).toBeCloseTo(1 / 62);
  });

  it('同键跨相同连接器时得分累加', () => {
    const same: RankedGroup[] = [
      { hits: [hit('a', 'web')], weight: 1 },
      { hits: [hit('a', 'web')], weight: 1 },
    ];
    const map = reciprocalRankFusion(same);
    expect(map.get('web:a')!.score).toBeCloseTo(2 / 61);
  });

  it('不同 sourceType 视为不同键（不累加）', () => {
    const groups: RankedGroup[] = [
      { hits: [hit('a', 'web')], weight: 1 },
      { hits: [hit('a', 'vertical')], weight: 1 },
    ];
    const map = reciprocalRankFusion(groups);
    expect(map.size).toBe(2);
  });

  it('本地路权重 1.2 生效（rank1 => 1.2/61）', () => {
    const groups: RankedGroup[] = [{ hits: [hit('a', 'local')], weight: 1.2 }];
    const map = reciprocalRankFusion(groups);
    expect(map.get('local:a')!.score).toBeCloseTo(1.2 / 61);
  });

  it('hitKey 以 sourceType+url 去重，url 缺省回退 title', () => {
    expect(hitKey(hit('x'))).toBe('web:x');
    expect(hitKey({ ...hit('x'), url: undefined })).toBe('web:x');
  });
});
