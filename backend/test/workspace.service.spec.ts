import { describe, it, expect, vi, afterEach } from 'vitest';
import { WorkspaceService } from '../src/modules/workspace/workspace.service';

describe('WorkspaceService.getDataset', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('组装结构化时序矩阵（mock WDI，null 值跳过）', async () => {
    const fakeJson = [
      { page: 1, pages: 1, per_page: 100, total: 4 },
      [
        { countryiso3code: 'CHN', date: '2020', value: 14.7, indicator: { value: 'GDP' } },
        { countryiso3code: 'CHN', date: '2021', value: 17.7, indicator: { value: 'GDP' } },
        { countryiso3code: 'USA', date: '2020', value: 21.0, indicator: { value: 'GDP' } },
        { countryiso3code: 'USA', date: '2021', value: null, indicator: { value: 'GDP' } },
      ],
    ];
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => fakeJson })) as unknown as typeof fetch;

    const svc = new WorkspaceService();
    const res = await svc.getDataset(['中国', '美国'], ['GDP'], 2020, 2021, new AbortController().signal);

    expect(res.source).toBe('世界发展指标数据库（WDI）');
    expect(res.years).toEqual(['2020', '2021']);
    expect(res.indicators).toHaveLength(1);
    const ind = res.indicators[0];
    expect(ind.indicator).toBe('GDP');
    expect(ind.indicatorCode).toBe('NY.GDP.MKTP.CD');
    expect(ind.series).toHaveLength(2);
    const china = ind.series.find((s) => s.iso3 === 'CHN')!;
    expect(china.country).toBe('中国');
    expect(china.values).toEqual({ '2020': 14.7, '2021': 17.7 });
    // null 值被跳过（缺失年份无键）
    const usa = ind.series.find((s) => s.iso3 === 'USA')!;
    expect(usa.values).toEqual({ '2020': 21.0 });
  });

  it('无国家或无指标返回空结果（不查 WDI）', async () => {
    const svc = new WorkspaceService();
    const spy = vi.spyOn(globalThis, 'fetch');
    const empty = await svc.getDataset([], [], 2020, 2021, new AbortController().signal);
    expect(empty.indicators).toEqual([]);
    expect(empty.years).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('单指标取数失败跳过，不阻断其他指标', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('WDI HTTP 500'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { page: 1, pages: 1, per_page: 100, total: 1 },
          [{ countryiso3code: 'CHN', date: '2020', value: 1411, indicator: { value: '人口' } }],
        ],
      }) as unknown as typeof fetch;

    const svc = new WorkspaceService();
    const res = await svc.getDataset(['中国'], ['GDP', '人口'], 2020, 2020, new AbortController().signal);
    expect(res.indicators).toHaveLength(1);
    expect(res.indicators[0].indicator).toBe('人口');
    expect(res.indicators[0].series[0].values).toEqual({ '2020': 1411 });
  });
});
