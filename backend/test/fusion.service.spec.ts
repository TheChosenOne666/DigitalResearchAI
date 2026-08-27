import { describe, it, expect } from 'vitest';
import { fuse } from '../src/modules/search/fusion/fusion.service';
import type { SearchHit } from '../src/modules/search/connectors/connector.interface';

function hit(title: string, sourceType: SearchHit['sourceType']): SearchHit {
  return { title, url: `https://e/${title}`, snippet: `s-${title}`, sourceType };
}

describe('fuse', () => {
  it('三路合并并按 RRF 降序截断 TopK，区分引用/参考级', () => {
    const hits: SearchHit[] = [
      hit('a', 'web'),
      hit('b', 'web'),
      hit('c', 'vertical'),
      hit('d', 'vertical'),
    ];
    const r = fuse(hits, { topK: 3, citeCount: 2 });
    expect(r.ranked).toHaveLength(3);
    expect(r.cited).toHaveLength(2);
    expect(r.referenced).toHaveLength(1);
    for (let i = 1; i < r.ranked.length; i++) {
      expect(r.ranked[i - 1].score).toBeGreaterThanOrEqual(r.ranked[i].score);
    }
  });

  it('本地路加权后排名更靠前', () => {
    const hits: SearchHit[] = [hit('web1', 'web'), hit('local1', 'local')];
    const r = fuse(hits, { topK: 10, citeCount: 10 });
    expect(r.ranked[0].hit.sourceType).toBe('local');
  });

  it('相同正文被 SimHash 去重（保留一条）', () => {
    const md = '经济 发展 数据 分析 指标 研究 统计 报告 长篇 内容';
    const hits: SearchHit[] = [
      { title: 'x', snippet: '', sourceType: 'web', contentMd: md },
      { title: 'y', snippet: '', sourceType: 'web', contentMd: md },
      { title: 'z', snippet: '', sourceType: 'web', contentMd: '美国 人口 总数 2020 独立 内容 篇章' },
    ];
    const r = fuse(hits, { topK: 10, citeCount: 10 });
    expect(r.ranked.length).toBe(2); // 两条相同正文合并为一条
  });

  it('空输入返回全空', () => {
    const r = fuse([], {});
    expect(r.cited).toEqual([]);
    expect(r.referenced).toEqual([]);
    expect(r.ranked).toEqual([]);
  });
});
