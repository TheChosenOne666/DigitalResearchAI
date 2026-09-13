import { describe, it, expect } from 'vitest';
import {
  isLocalEnough,
  searchLocalFirstImpl,
  DEFAULT_LOCAL_FIRST,
} from '../src/modules/search/search.service';
import type {
  ConnectorInput,
  SearchConnector,
  SearchHit,
  SourceType,
} from '../src/modules/search/connectors/connector.interface';

/** 构造一条命中（key 用于避免 SimHash 去重） */
function hit(sourceType: SourceType, key: string, score?: number): SearchHit {
  return {
    title: `${sourceType}-标题-${key}`,
    snippet: `${sourceType} 摘要内容 ${key}`,
    sourceType,
    rawScore: score,
  };
}

/** 可统计调用次数的假连接器 */
function fakeConnector(
  sourceType: SourceType,
  hits: SearchHit[],
  fail = false,
): SearchConnector & { calls: number } {
  const conn = {
    sourceType,
    calls: 0,
    async search(): Promise<SearchHit[]> {
      conn.calls += 1;
      if (fail) throw new Error('模拟本地路异常');
      return hits;
    },
  };
  return conn as SearchConnector & { calls: number };
}

const INPUT: ConnectorInput = { question: '测试问题', conditions: {} };
const signal = new AbortController().signal;

/** 组装三路假连接器 */
function build(localHits: SearchHit[], webHits: SearchHit[], localFail = false) {
  const local = fakeConnector('local', localHits, localFail);
  const web = fakeConnector('web', webHits);
  const vertical = fakeConnector('vertical', []);
  return { local, web, vertical, all: [local, web, vertical] };
}

describe('search/searchLocalFirstImpl（知识库优先 + 串行兜底）', () => {
  it('知识库命中足够 → 短路，外网连接器完全不被调用', async () => {
    const { local, web, vertical, all } = build(
      [hit('local', 'a', 0.9), hit('local', 'b', 0.85), hit('local', 'c', 0.8)],
      [hit('web', 'w', 0.99)],
    );
    const r = await searchLocalFirstImpl(all, INPUT, signal);
    expect(r.shortCircuited).toBe(true);
    expect(web.calls).toBe(0);
    expect(vertical.calls).toBe(0);
    expect(local.calls).toBe(1);
    expect(r.localHits).toBe(3);
    expect(r.localTopScore).toBeCloseTo(0.9);
    expect(r.routes).toEqual(['local']);
    // 结果应全部来自知识库
    expect([...r.cited, ...r.referenced].every((h) => h.sourceType === 'local')).toBe(true);
  });

  it('命中条数不足 → 补跑外网并合并两路结果', async () => {
    const { web, vertical, all } = build(
      [hit('local', 'a', 0.95), hit('local', 'b', 0.9)],
      [hit('web', 'w', 0.9)],
    );
    const r = await searchLocalFirstImpl(all, INPUT, signal);
    expect(r.shortCircuited).toBe(false);
    expect(web.calls).toBe(1);
    expect(vertical.calls).toBe(1);
    expect(r.routes).toContain('local');
    expect(r.routes).toContain('web');
    const types = [...r.cited, ...r.referenced].map((h) => h.sourceType);
    expect(types).toContain('local');
    expect(types).toContain('web');
  });

  it('条数够但最高相似度不足 → 仍补跑外网', async () => {
    const { web, all } = build(
      [hit('local', 'a', 0.4), hit('local', 'b', 0.35), hit('local', 'c', 0.3)],
      [hit('web', 'w')],
    );
    const r = await searchLocalFirstImpl(all, INPUT, signal);
    expect(r.shortCircuited).toBe(false);
    expect(web.calls).toBe(1);
    expect(r.localTopScore).toBeCloseTo(0.4);
  });

  it('边界：恰好达标（3 条且最高分恰好 0.5）→ 短路', async () => {
    const { web, all } = build(
      [hit('local', 'a', 0.5), hit('local', 'b', 0.5), hit('local', 'c', 0.5)],
      [hit('web', 'w')],
    );
    const r = await searchLocalFirstImpl(all, INPUT, signal);
    expect(r.shortCircuited).toBe(true);
    expect(web.calls).toBe(0);
  });

  it('知识库为空 → 视为不足并兜底外网', async () => {
    const { web, all } = build([], [hit('web', 'w')]);
    const r = await searchLocalFirstImpl(all, INPUT, signal);
    expect(r.shortCircuited).toBe(false);
    expect(r.localHits).toBe(0);
    expect(r.localTopScore).toBe(0);
    expect(web.calls).toBe(1);
  });

  it('本地路异常 → 不抛错，按不足处理并兜底外网', async () => {
    const { local, web, all } = build([], [hit('web', 'w')], true);
    const r = await searchLocalFirstImpl(all, INPUT, signal);
    expect(local.calls).toBe(1);
    expect(web.calls).toBe(1);
    expect(r.shortCircuited).toBe(false);
    expect(r.localHits).toBe(0);
  });

  it('阈值可通过参数覆盖（minHits=1 时单条高分即短路）', async () => {
    const { web, all } = build([hit('local', 'a', 0.9)], [hit('web', 'w')]);
    const r = await searchLocalFirstImpl(all, INPUT, signal, undefined, {
      minHits: 1,
      minScore: 0.8,
    });
    expect(r.shortCircuited).toBe(true);
    expect(web.calls).toBe(0);
  });
});

describe('search/isLocalEnough（纯函数判定）', () => {
  it('命中条数不足 → false', () => {
    expect(isLocalEnough([hit('local', 'a', 0.99), hit('local', 'b', 0.99)])).toBe(false);
  });

  it('条数够但最高相似度不足 → false', () => {
    expect(
      isLocalEnough([hit('local', 'a', 0.49), hit('local', 'b', 0.4), hit('local', 'c', 0.3)]),
    ).toBe(false);
  });

  it('条数与相似度均达标 → true', () => {
    expect(
      isLocalEnough([hit('local', 'a', 0.8), hit('local', 'b', 0.7), hit('local', 'c', 0.6)]),
    ).toBe(true);
  });

  it('rawScore 缺失视为 0 → false', () => {
    expect(isLocalEnough([hit('local', 'a'), hit('local', 'b'), hit('local', 'c')])).toBe(false);
  });

  it('默认阈值为 3 条 / 0.5', () => {
    expect(DEFAULT_LOCAL_FIRST).toEqual({ minHits: 3, minScore: 0.5 });
  });

  it('阈值可覆盖', () => {
    expect(isLocalEnough([hit('local', 'a', 0.6)], { minHits: 1, minScore: 0.5 })).toBe(true);
    expect(isLocalEnough([hit('local', 'a', 0.6)], { minHits: 1, minScore: 0.7 })).toBe(false);
  });
});
