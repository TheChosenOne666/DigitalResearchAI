import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('ai', () => ({
  streamText: vi.fn(),
}));

import { streamText } from 'ai';
import {
  GenerateService,
  parseCitations,
  buildGeneratePrompt,
} from '../src/modules/search/generate/generate.service';
import type { SearchHit } from '../src/modules/search/connectors/connector.interface';

const cfg = (over: Record<string, string> = {}): any => ({ get: (k: string) => over[k] });

const hit = (title: string, contentMd?: string): SearchHit => ({
  title,
  snippet: '',
  contentMd,
  sourceType: 'vertical',
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseCitations', () => {
  it('提取 {c:N} 编号（多个）', () => {
    expect(parseCitations('据 {c:1} 显示，{c:2} 亦有依据')).toEqual([1, 2]);
  });
  it('无引文返回空数组', () => {
    expect(parseCitations('普通文本')).toEqual([]);
  });
});

describe('buildGeneratePrompt', () => {
  it('按 {c:N} 编号来源并拼接问题/条件', () => {
    const prompt = buildGeneratePrompt('美国 GDP', { indicators: ['GDP'] }, [
      hit('A', '内容A'),
      hit('B'),
    ]);
    expect(prompt).toContain('用户问题：美国 GDP');
    expect(prompt).toContain('指标=GDP');
    expect(prompt).toContain('[1] A');
    expect(prompt).toContain('内容A');
    expect(prompt.match(/\[(\d+)\]/g)).toEqual(['[1]', '[2]']);
  });
  it('无来源时给出无参考提示', () => {
    const prompt = buildGeneratePrompt('q', {}, []);
    expect(prompt).toContain('无参考资料');
  });
});

describe('GenerateService.stream', () => {
  it('无 ARK_API_KEY 时降级输出检索摘要', async () => {
    const svc = new GenerateService(cfg({}));
    const chunks: any[] = [];
    const result = await svc.stream(
      { question: 'q', conditions: {}, sources: [hit('A', 'a')] },
      new AbortController().signal,
      (c) => chunks.push(c),
    );
    expect(result.fullText).toContain('检索结果摘要');
    expect(result.tokenUsage).toBe(0);
    expect(chunks.length).toBe(1);
    expect(chunks[0].text).toContain('A');
  });

  it('LLM 路径：逐分片回调并累计全文/用量', async () => {
    (streamText as any).mockResolvedValue({
      textStream: (async function* () {
        yield '据{c:1}';
        yield '数据。\n报告';
      })(),
      usage: Promise.resolve({ totalTokens: 42 }),
    });
    const svc = new GenerateService(cfg({ ARK_API_KEY: 'x' }));
    const chunks: any[] = [];
    const result = await svc.stream(
      { question: 'q', conditions: {}, sources: [hit('A', 'a')] },
      new AbortController().signal,
      (c) => chunks.push(c),
    );
    expect(result.fullText).toBe('据{c:1}数据。\n报告');
    expect(result.tokenUsage).toBe(42);
    expect(result.citations).toEqual([1]);
    expect(chunks).toEqual([
      { text: '据{c:1}', citations: [1] },
      { text: '数据。\n报告', citations: [] },
    ]);
    expect(streamText).toHaveBeenCalled();
  });

  it('LLM 抛错时降级输出摘要（不阻断）', async () => {
    (streamText as any).mockRejectedValue(new Error('llm down'));
    const svc = new GenerateService(cfg({ ARK_API_KEY: 'x' }));
    const result = await svc.stream(
      { question: 'q', conditions: {}, sources: [] },
      new AbortController().signal,
      () => {},
    );
    expect(result.fullText).toContain('检索结果摘要');
  });
});