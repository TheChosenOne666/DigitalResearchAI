import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('ai', () => ({
  streamText: vi.fn(),
}));

import { streamText } from 'ai';
import { IntentService, extractJson } from '../src/modules/search/intent/intent.service';
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
  it('无 ARK_API_KEY 时降级返回空条件与 null 重写', async () => {
    const svc = new IntentService(cfg({}), metrics());
    const r = await svc.classify('美国 GDP', new AbortController().signal);
    expect(r).toEqual({ rewrittenQuestion: null });
  });

  it('成功时返回结构化条件与重写问题', async () => {
    (streamText as any).mockReturnValue({
      text: Promise.resolve(
        '{"rewrittenQuestion":"比较2018-2022年美国GDP及相关指标","countries":["美国"],"indicators":["GDP"],"yearFrom":2018,"yearTo":2022,"routeHints":["vertical"]}',
      ),
    });
    const svc = new IntentService(
      cfg({ ARK_API_KEY: 'x', ARK_BASE_URL: 'https://x', INTENT_LLM_MODEL: 'm' }),
      metrics(),
    );
    const r = await svc.classify('美国 GDP 2018-2022', new AbortController().signal);
    expect(r.countries).toEqual(['美国']);
    expect(r.yearFrom).toBe(2018);
    expect(r.yearTo).toBe(2022);
    expect(r.rewrittenQuestion).toBe('比较2018-2022年美国GDP及相关指标');
    expect(streamText).toHaveBeenCalled();
  });

  it('LLM 未输出重写问题时返回 null（调用方回退原问题）', async () => {
    (streamText as any).mockReturnValue({
      text: Promise.resolve('{"countries":["美国"],"indicators":[],"yearFrom":null,"yearTo":null,"routeHints":[]}'),
    });
    const svc = new IntentService(cfg({ ARK_API_KEY: 'x' }), metrics());
    const r = await svc.classify('美国 GDP', new AbortController().signal);
    expect(r.rewrittenQuestion).toBeNull();
    expect(r.countries).toEqual(['美国']);
  });

  it('调用失败时降级返回空条件与 null 重写', async () => {
    (streamText as any).mockReturnValue({
      text: Promise.reject(new Error('boom')),
    });
    const svc = new IntentService(cfg({ ARK_API_KEY: 'x' }), metrics());
    const r = await svc.classify('hello', new AbortController().signal);
    expect(r).toEqual({ rewrittenQuestion: null });
  });
});

describe('extractJson 提取（纯函数）', () => {
  it('整段 JSON 直接解析', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('容忍 markdown 围栏', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('容忍思考前后缀，提取首个 { 到末个 }', () => {
    expect(extractJson('思考中……结果如下：{"a":1} 以上')).toEqual({ a: 1 });
  });

  it('非 JSON 返回 null', () => {
    expect(extractJson('没有 JSON')).toBeNull();
    expect(extractJson('')).toBeNull();
  });
});
