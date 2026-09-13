import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { SearchHit } from '../src/modules/search/connectors/connector.interface';
import { MetricsService } from '../src/common/observability/metrics.service';

/** streamText mock（可按用例覆写返回/抛错；返回 { text: Promise<string> } 与真实 streamText 结构一致） */
const genText = vi.hoisted(() => ({ impl: null as null | ((opts: unknown) => Promise<{ text: string }>) }));

vi.mock('ai', () => ({
  streamText: (opts: unknown) => ({
    text: genText.impl ? genText.impl(opts).then((r) => r.text) : Promise.resolve(''),
  }),
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: () => () => ({ modelId: 'mock' }),
}));

const { RerankService, parseRerankOutput, buildRerankPrompt } = await import(
  '../src/modules/search/fusion/rerank.service'
);

const hit = (title: string): SearchHit => ({ title, snippet: `摘要-${title}`, sourceType: 'web', url: `https://${title}` });

/** 构造服务：默认带 ARK Key（enabled） */
function makeService(opts?: { noKey?: boolean }) {
  const config = {
    get: (k: string, d?: string) => (k === 'ARK_API_KEY' && !opts?.noKey ? 'test-key' : d),
  } as unknown as ConfigService;
  const metrics = new MetricsService({ get: (_k: string, d?: string) => d } as any);
  return new RerankService(config, metrics);
}

describe('parseRerankOutput 输出解析（纯函数）', () => {
  it('标准 JSON 数组：按序返回去重编号', () => {
    expect(parseRerankOutput('[3,1,2]')).toEqual([3, 1, 2]);
    expect(parseRerankOutput('[2,2,1]')).toEqual([2, 1]);
  });

  it('容忍 markdown 围栏与前后缀文本', () => {
    expect(parseRerankOutput('好的，排序如下：\n```json\n[2,1]\n```\n以上')).toEqual([2, 1]);
  });

  it('非法输入返回 null：无数组 / 空数组 / 全非数字', () => {
    expect(parseRerankOutput('没有数组')).toBeNull();
    expect(parseRerankOutput('[]')).toBeNull();
    expect(parseRerankOutput('["a","b"]')).toBeNull();
  });
});

describe('buildRerankPrompt 构造（纯函数）', () => {
  it('包含问题、1 起编号候选与 JSON 输出指令', () => {
    const p = buildRerankPrompt('GDP 增长', [hit('A'), hit('B')]);
    expect(p).toContain('GDP 增长');
    expect(p).toContain('[1] A：摘要-A');
    expect(p).toContain('[2] B：摘要-B');
    expect(p).toContain('JSON 数组');
  });
});

describe('RerankService.rerank（检索优化 C）', () => {
  beforeEach(() => {
    genText.impl = null;
  });

  it('未配置 Key：直接跳过返回 null', async () => {
    const svc = makeService({ noKey: true });
    await expect(svc.rerank('q', [hit('A'), hit('B')])).resolves.toBeNull();
  });

  it('候选不足 2 条：跳过（无精排意义）', async () => {
    const svc = makeService();
    await expect(svc.rerank('q', [hit('A')])).resolves.toBeNull();
  });

  it('正常精排：按 LLM 返回顺序重排，遗漏编号补尾', async () => {
    const svc = makeService();
    genText.impl = async () => ({ text: '[2,1]' });
    const hits = [hit('A'), hit('B'), hit('C')];
    const out = await svc.rerank('q', hits);
    // LLM 仅给出 [2,1]，C 按原序补尾
    expect(out?.map((h) => h.title)).toEqual(['B', 'A', 'C']);
  });

  it('LLM 输出不可解析：返回 null 回退原序', async () => {
    const svc = makeService();
    genText.impl = async () => ({ text: '排序：第二个最好' });
    await expect(svc.rerank('q', [hit('A'), hit('B')])).resolves.toBeNull();
  });

  it('LLM 调用异常（含超时）：返回 null 回退原序', async () => {
    const svc = makeService();
    genText.impl = async () => {
      throw new Error('timeout');
    };
    await expect(svc.rerank('q', [hit('A'), hit('B')])).resolves.toBeNull();
  });
});
