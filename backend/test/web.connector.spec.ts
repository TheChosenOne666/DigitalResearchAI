import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseAnySearchResponse,
  WebAnySearchConnector,
} from '../src/modules/search/connectors/web.connector';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseAnySearchResponse', () => {
  it('提取 data.results 列表', () => {
    const json = {
      code: 0,
      message: 'success',
      data: {
        results: [{ title: 't', url: 'https://e.com', snippet: 's', content: 'c' }],
      },
    };
    const r = parseAnySearchResponse(json);
    expect(r).toHaveLength(1);
    expect(r[0].url).toBe('https://e.com');
    expect(r[0].content).toBe('c');
  });

  it('畸形响应/业务码非 0 返回空数组', () => {
    expect(parseAnySearchResponse(null)).toEqual([]);
    expect(parseAnySearchResponse({})).toEqual([]);
    expect(parseAnySearchResponse({ code: 1, data: { results: [] } })).toEqual([]);
    expect(parseAnySearchResponse({ code: 0, results: [{ url: 'https://e.com' }] })).toEqual([]);
  });
});

describe('WebAnySearchConnector', () => {
  it('无 KEY 时以匿名模式调用并映射结果', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            results: [{ title: 'T', url: 'https://e.com', snippet: 's', content: 'c' }],
          },
        }),
      })) as any,
    );
    const c = new WebAnySearchConnector({ get: () => '' } as any);
    const r = await c.search({ question: 'q', conditions: {} } as any, new AbortController().signal);
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe('T');
    expect(r[0].sourceType).toBe('web');
    expect(r[0].snippet).toBe('s');
    expect(r[0].contentMd).toBe('c');
  });

  it('携带 KEY 时发送 Bearer 头', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ code: 0, data: { results: [] } }),
    })) as any;
    vi.stubGlobal('fetch', fetchMock);
    const c = new WebAnySearchConnector({
      get: (k: string) => (k === 'ANYSEARCH_API_KEY' ? 'key' : ''),
    } as any);
    await c.search({ question: 'q', conditions: {} } as any, new AbortController().signal);
    const call = fetchMock.mock.calls[0];
    expect(call[1].headers['Authorization']).toBe('Bearer key');
  });

  it('请求失败时返回空且不抛出', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })) as any);
    const c = new WebAnySearchConnector({ get: () => 'key' } as any);
    const r = await c.search({ question: 'q', conditions: {} } as any, new AbortController().signal);
    expect(r).toEqual([]);
  });
});
