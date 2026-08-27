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

describe('SearchService.search 三模式路由（M3.3）', () => {
  it('routes 指定时仅调用对应来源的连接器', async () => {
    const vertical = mockConn('vertical', [{ title: 'v', snippet: '', sourceType: 'vertical' }]);
    const web = mockConn('web', [{ title: 'w', snippet: '', sourceType: 'web' }]);
    const local = mockConn('local', [{ title: 'l', snippet: '', sourceType: 'local' }]);
    const svc = new SearchService([web, vertical, local]);

    // mode=local → 仅本地路
    const res = await svc.search(input, new AbortController().signal, undefined, new Set(['local']));
    expect(vertical.search).not.toHaveBeenCalled();
    expect(web.search).not.toHaveBeenCalled();
    expect(local.search).toHaveBeenCalledTimes(1);
    expect(res.ranked[0].hit.sourceType).toBe('local');

    // mode=web → 联网+垂直，无本地
    await svc.search(input, new AbortController().signal, undefined, new Set(['web', 'vertical']));
    expect(web.search).toHaveBeenCalledTimes(1);
    expect(vertical.search).toHaveBeenCalledTimes(1);
    expect(local.search).toHaveBeenCalledTimes(1); // 上一步调用后未再增加

    // mode=hybrid（全量等价缺省）
    await svc.search(input, new AbortController().signal, undefined, new Set(['web', 'vertical', 'local']));
    expect(web.search).toHaveBeenCalledTimes(2);
    expect(vertical.search).toHaveBeenCalledTimes(2);
    expect(local.search).toHaveBeenCalledTimes(2);
  });

  it('routes 缺省跑全部连接器（向后兼容）', async () => {
    const vertical = mockConn('vertical', []);
    const local = mockConn('local', []);
    const svc = new SearchService([vertical, local]);
    await svc.search(input, new AbortController().signal);
    expect(vertical.search).toHaveBeenCalledTimes(1);
    expect(local.search).toHaveBeenCalledTimes(1);
  });

  it('routes 过滤后本地路加权仍生效（fusion localWeight）', async () => {
    const localA = mockConn('local', [
      { title: 'la', snippet: '', sourceType: 'local' },
    ]);
    const localB = mockConn('local', [
      { title: 'lb', snippet: '', sourceType: 'local' },
    ]);
    const svc = new SearchService([localB, localA]);
    const res = await svc.search(
      input,
      new AbortController().signal,
      { topK: 10, citeCount: 6, localWeight: 1.2 },
      new Set(['local']),
    );
    // 仅本地两路：RRF 得分相同（同 rank），命中都保留
    expect(res.ranked.length).toBe(2);
  });
});
