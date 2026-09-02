import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('ai', () => ({
  generateObject: vi.fn(),
}));

import { generateObject } from 'ai';
import { IntentService } from '../src/modules/search/intent/intent.service';
import type { SearchConditions } from '../src/modules/search/connectors/connector.interface';
import { MetricsService } from '../src/common/observability/metrics.service';

const cfg = (over: Record<string, string> = {}): any => ({ get: (k: string) => over[k] });

/**
 * 指标服务桩：直接实例化但不触发 onModuleInit，避免测试连接 Redis。
 * M7.1 后 IntentService 需注入该依赖记录 LLM 调用结果。
 */
const metrics = (): MetricsService => new MetricsService(cfg({}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('IntentService.mergeConditions', () => {
  it('手动条件非空时覆盖 AI 结果', () => {
    const manual: SearchConditions = {
      countries: ['美国'],
      indicators: ['GDP'],
      yearFrom: 2020,
      yearTo: 2024,
      routeHints: ['vertical'],
    };
    const ai: SearchConditions = {
      countries: ['中国'],
      indicators: ['人口'],
      yearFrom: null,
      yearTo: 2023,
      routeHints: ['web'],
    };
    const r = IntentService.mergeConditions(manual, ai);
    expect(r.countries).toEqual(['美国']);
    expect(r.indicators).toEqual(['GDP']);
    expect(r.yearFrom).toBe(2020);
    expect(r.yearTo).toBe(2024);
    expect(r.routeHints).toEqual(['vertical']);
  });

  it('手动为空时回退 AI 结果', () => {
    const manual: SearchConditions = {};
    const ai: SearchConditions = {
      countries: ['中国'],
      indicators: ['人口'],
      yearFrom: null,
      yearTo: null,
      routeHints: ['web'],
    };
    const r = IntentService.mergeConditions(manual, ai);
    expect(r.countries).toEqual(['中国']);
    expect(r.yearFrom).toBeNull();
    expect(r.routeHints).toEqual(['web']);
  });
});

describe('IntentService.classify', () => {
  it('无 ARK_API_KEY 时降级返回空条件', async () => {
    const svc = new IntentService(cfg({}), metrics());
    const r = await svc.classify('美国 GDP', new AbortController().signal);
    expect(r).toEqual({});
  });

  it('成功时返回结构化条件', async () => {
    (generateObject as any).mockResolvedValue({
      object: {
        countries: ['美国'],
        indicators: ['GDP'],
        yearFrom: 2018,
        yearTo: 2022,
        routeHints: ['vertical'],
      },
    });
    const svc = new IntentService(
      cfg({ ARK_API_KEY: 'x', ARK_BASE_URL: 'https://x', LLM_MODEL: 'm' }),
      metrics(),
    );
    const r = await svc.classify('美国 GDP 2018-2022', new AbortController().signal);
    expect(r.countries).toEqual(['美国']);
    expect(r.yearFrom).toBe(2018);
    expect(r.yearTo).toBe(2022);
    expect(generateObject).toHaveBeenCalled();
  });

  it('调用失败时降级返回空条件', async () => {
    (generateObject as any).mockRejectedValue(new Error('boom'));
    const svc = new IntentService(cfg({ ARK_API_KEY: 'x' }), metrics());
    const r = await svc.classify('hello', new AbortController().signal);
    expect(r).toEqual({});
  });
});
