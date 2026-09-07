import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  VerticalWorldBankConnector,
  resolveCountryCodes,
  resolveIndicatorCodes,
  wdiToTableMarkdown,
  fetchWdi,
  type WdiObservation,
} from '../src/modules/search/connectors/vertical.connector';

describe('vertical connector 映射', () => {
  it('resolveCountryCodes 中文名→ISO3，未知原样大写', () => {
    expect(resolveCountryCodes(['中国', '美国', '法兰克'])).toEqual(['CHN', 'USA', '法兰克']);
  });

  it('resolveIndicatorCodes 中文名/代码→WDI 代码', () => {
    expect(resolveIndicatorCodes(['GDP', '人口'])).toEqual([
      { name: 'GDP', code: 'NY.GDP.MKTP.CD' },
      { name: '人口', code: 'SP.POP.TOTL' },
    ]);
  });

  it('wdiToTableMarkdown 生成时序表格（缺失年份填 —）', () => {
    const rows: WdiObservation[] = [
      { countryiso3code: 'USA', date: '2020', value: 1, indicator: { value: 'GDP' } },
      { countryiso3code: 'USA', date: '2021', value: 2, indicator: { value: 'GDP' } },
      { countryiso3code: 'CHN', date: '2020', value: 3, indicator: { value: 'GDP' } },
    ];
    const md = wdiToTableMarkdown(rows, {
      indicatorName: 'GDP',
      countryNames: { USA: '美国', CHN: '中国' },
    });
    expect(md).toContain('| 年份 | 美国 | 中国 |');
    expect(md).toContain('| 2020 | 1 | 3 |');
    expect(md).toContain('| 2021 | 2 | — |');
  });
});

describe('VerticalWorldBankConnector.search', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('无国家或无指标返回空（不查 WDI）', async () => {
    const c = new VerticalWorldBankConnector();
    const spy = vi.spyOn(globalThis, 'fetch');
    expect(await c.search({ question: 'q', conditions: {} }, new AbortController().signal)).toEqual([]);
    expect(await c.search({ question: 'q', conditions: { countries: ['美国'] } }, new AbortController().signal)).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('多指标并发拉取且结果保持指标原顺序（慢指标在前）', async () => {
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const code = String(url).split('/indicator/')[1]?.split('?')[0] ?? '';
      // 第二个指标（人口）更快返回，验证顺序仍按指标原序装配
      await new Promise((r) => setTimeout(r, code === 'SP.POP.TOTL' ? 1 : 20));
      return {
        ok: true,
        json: async () => [
          { page: 1, pages: 1, per_page: 100, total: 1 },
          [{ countryiso3code: 'USA', date: '2021', value: 1, indicator: { value: code } }],
        ],
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const c = new VerticalWorldBankConnector();
    const hits = await c.search(
      { question: 'q', conditions: { countries: ['美国'], indicators: ['GDP', '人口'] } },
      new AbortController().signal,
    );
    expect(hits.map((h) => h.title)).toEqual(['GDP（美国）', '人口（美国）']);
  });

  it('调用 WDI 并映射为垂直路 hit（mock fetch）', async () => {
    const fakeJson = [
      { page: 1, pages: 1, per_page: 100, total: 1 },
      [{ countryiso3code: 'USA', date: '2021', value: 23000000, indicator: { value: 'GDP' } }],
    ];
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => fakeJson })) as unknown as typeof fetch;

    const c = new VerticalWorldBankConnector();
    const hits = await c.search(
      { question: '美国 GDP', conditions: { countries: ['美国'], indicators: ['GDP'], yearFrom: 2020, yearTo: 2021 } },
      new AbortController().signal,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].sourceType).toBe('vertical');
    expect(hits[0].contentMd).toContain('美国');
    expect(hits[0].url).toContain('NY.GDP.MKTP.CD');
  });
});

describe('垂直路真实取数（联网 WDI，验收项）', () => {
  it('fetchWdi 真实返回美国 GDP 观测', async () => {
    const obs = await fetchWdi('NY.GDP.MKTP.CD', ['USA'], 2021, 2022, new AbortController().signal);
    expect(Array.isArray(obs)).toBe(true);
    expect(obs.length).toBeGreaterThan(0);
    expect(obs[0].countryiso3code).toBe('USA');
  }, 15_000);
});
