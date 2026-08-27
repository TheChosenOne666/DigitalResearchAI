import { describe, it, expect, vi } from 'vitest';
import { SearchService, runConnector } from '../src/modules/search/search.service';
import type { ConnectorInput, SearchConnector, SearchHit } from '../src/modules/search/connectors/connector.interface';

const input: ConnectorInput = {
  question: 'q',
  conditions: { countries: ['美国'], indicators: ['GDP'] },
};

function mockConn(
  sourceType: SearchHit['sourceType'],
  hits: SearchHit[] | (() => Promise<SearchHit[]>),
): SearchConnector {
  return {
    sourceType,
    search: vi.fn(async () => (typeof hits === 'function' ? await hits() : hits)),
  };
}

describe('runConnector', () => {
  it('正常返回命中', async () => {
    const conn = mockConn('vertical', [{ title: 'h', snippet: '', sourceType: 'vertical' }]);
    const out = await runConnector(conn, input, new AbortController().signal, 1000);
    expect(out).toHaveLength(1);
  });

  it('连接器抛错返回 []（不阻断整体）', async () => {
    const conn = mockConn('vertical', async () => {
      throw new Error('boom');
    });
    const out = await runConnector(conn, input, new AbortController().signal, 1000);
    expect(out).toEqual([]);
  });

  it('外部 abort 时立即返回 []（不挂起）', async () => {
    const conn = mockConn(
      'vertical',
      () =>
        new Promise<SearchHit[]>((r) =>
          setTimeout(() => r([{ title: 'x', snippet: '', sourceType: 'vertical' }]), 5000),
        ),
    );
    const outer = new AbortController();
    const p = runConnector(conn, input, outer.signal, 10000);
    outer.abort();
    expect(await p).toEqual([]);
  });
});

describe('SearchService.search', () => {
  it('汇总多路命中并融合', async () => {
    const svc = new SearchService([
      mockConn('vertical', [{ title: 'v', snippet: '', sourceType: 'vertical', contentMd: '美国 GDP' }]),
      mockConn('local', []),
    ]);
    const res = await svc.search(input, new AbortController().signal);
    expect(res.ranked.length).toBe(1);
    expect(res.cited[0].sourceType).toBe('vertical');
  });

  it('单路失败不阻断整体，其余路正常返回', async () => {
    const svc = new SearchService([
      mockConn('vertical', async () => {
        throw new Error('x');
      }),
      mockConn('local', [{ title: 'l', snippet: '', sourceType: 'local' }]),
    ]);
    const res = await svc.search(input, new AbortController().signal);
    expect(res.ranked.length).toBe(1);
    expect(res.ranked[0].hit.sourceType).toBe('local');
  });
});
