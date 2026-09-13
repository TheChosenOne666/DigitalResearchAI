import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('ai', () => ({
  streamText: vi.fn(),
}));

import { streamText } from 'ai';
import {
  GenerateService,
  parseCitations,
  buildGeneratePrompt,
  classifyLlmError,
  friendlyLlmError,
} from '../src/modules/search/generate/generate.service';
import type { SearchHit } from '../src/modules/search/connectors/connector.interface';
import { MetricsService } from '../src/common/observability/metrics.service';

const cfg = (over: Record<string, string> = {}): any => ({ get: (k: string) => over[k] });

/**
 * 指标服务桩：直接实例化但不触发 onModuleInit，避免测试连接 Redis。
 * M7.1 后 GenerateService 需注入该依赖记录 LLM 调用结果。
 */
const metrics = (): MetricsService => new MetricsService(cfg({}));

const hit = (title: string, contentMd?: string): SearchHit => ({
  title,
  snippet: '',
  contentMd,
  sourceType: 'vertical',
});

/** 构造 fullStream：文本分片数组 → text-delta 分片序列 */
const textParts = (...texts: string[]) => texts.map((text) => ({ type: 'text-delta', id: 't1', text }));

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
  it('L2 来源隔离：参考资料包裹在 untrusted_context 标签内', () => {
    const prompt = buildGeneratePrompt('q', {}, [hit('A', '内容A')]);
    expect(prompt).toContain('<untrusted_context>');
    expect(prompt).toContain('</untrusted_context>');
    expect(prompt).toContain('不可信数据');
    // 用户问题（可信指令）在标签外，来源内容在标签内
    expect(prompt.indexOf('用户问题：q')).toBeLessThan(prompt.indexOf('<untrusted_context>'));
    expect(prompt.indexOf('内容A')).toBeGreaterThan(prompt.indexOf('<untrusted_context>'));
  });
});

describe('GenerateService.stream', () => {
  it('无 ARK_API_KEY 时降级输出检索摘要', async () => {
    const svc = new GenerateService(cfg({}), metrics());
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
      fullStream: (async function* () {
        yield* textParts('据{c:1}', '数据。\n报告');
      })(),
      usage: Promise.resolve({ totalTokens: 42 }),
    });
    const svc = new GenerateService(cfg({ ARK_API_KEY: 'x' }), metrics());
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
    const svc = new GenerateService(cfg({ ARK_API_KEY: 'x' }), metrics());
    const result = await svc.stream(
      { question: 'q', conditions: {}, sources: [] },
      new AbortController().signal,
      () => {},
    );
    expect(result.fullText).toContain('检索结果摘要');
  });
});

describe('GenerateService.streamCustom', () => {
  it('无 ARK_API_KEY 时降级输出 fallbackText', async () => {
    const svc = new GenerateService(cfg({}), metrics());
    const chunks: any[] = [];
    const result = await svc.streamCustom(
      { system: 'sys', prompt: 'p', fallbackText: '降级正文' },
      new AbortController().signal,
      (c) => chunks.push(c),
    );
    expect(result.fullText).toBe('降级正文');
    expect(result.tokenUsage).toBe(0);
    expect(chunks).toEqual([{ text: '降级正文', citations: [] }]);
  });

  it('LLM 路径：使用传入的 system/prompt 并累计全文', async () => {
    (streamText as any).mockResolvedValue({
      fullStream: (async function* () {
        yield* textParts('章节');
      })(),
      usage: Promise.resolve({ totalTokens: 7 }),
    });
    const svc = new GenerateService(cfg({ ARK_API_KEY: 'x' }), metrics());
    const result = await svc.streamCustom(
      { system: 'SYSTEM', prompt: 'PROMPT', fallbackText: 'fb' },
      new AbortController().signal,
      () => {},
    );
    expect(result.fullText).toBe('章节');
    expect(result.tokenUsage).toBe(7);
    expect(streamText).toHaveBeenCalledWith(expect.objectContaining({ system: 'SYSTEM', prompt: 'PROMPT' }));
  });

  it('error 分片（如账号欠费）：降级输出而非静默空白（2026-09-10 修复）', async () => {
    const overdue = Object.assign(new Error('account overdue'), {
      cause: { code: 'AccountOverdueError' },
      statusCode: 403,
    });
    (streamText as any).mockResolvedValue({
      // 关键：API 级错误以 error 分片出现，不抛异常、也没有任何正文
      fullStream: (async function* () {
        yield { type: 'error', error: overdue };
      })(),
      usage: Promise.resolve({ totalTokens: 0 }),
    });
    const svc = new GenerateService(cfg({ ARK_API_KEY: 'x' }), metrics());
    const chunks: any[] = [];
    const result = await svc.streamCustom(
      { system: 's', prompt: 'p', fallbackText: '本章生成失败，可重试' },
      new AbortController().signal,
      (c) => chunks.push(c),
    );
    // 必须产出可渲染的降级正文（修复前 fullText 为空串，报告只剩章节标题）
    expect(result.fullText).toBe('本章生成失败，可重试');
    expect(chunks).toEqual([{ text: '本章生成失败，可重试', citations: [] }]);
  });

  it('空产出（无 error 分片）：同样降级，不当作成功', async () => {
    (streamText as any).mockResolvedValue({
      fullStream: (async function* () {
        yield* textParts('   '); // 只有空白
      })(),
      usage: Promise.resolve({ totalTokens: 3 }),
    });
    const svc = new GenerateService(cfg({ ARK_API_KEY: 'x' }), metrics());
    const result = await svc.streamCustom(
      { system: 's', prompt: 'p', fallbackText: '降级正文' },
      new AbortController().signal,
      () => {},
    );
    expect(result.fullText).toBe('降级正文');
    expect(result.tokenUsage).toBe(0);
  });

  it('abort 分片（用户中止）：走降级分支且不产出半截正文', async () => {
    (streamText as any).mockResolvedValue({
      fullStream: (async function* () {
        yield* textParts('半截内容');
        yield { type: 'abort', reason: 'user' };
      })(),
      usage: Promise.resolve({ totalTokens: 5 }),
    });
    const svc = new GenerateService(cfg({ ARK_API_KEY: 'x' }), metrics());
    const result = await svc.streamCustom(
      { system: 's', prompt: 'p', fallbackText: '降级正文' },
      new AbortController().signal,
      () => {},
    );
    // 上层（控制器）会因 signal.aborted 丢弃该章内容，这里只需确认不把半截正文当完整结果
    expect(result.fullText).toBe('降级正文');
    expect(result.tokenUsage).toBe(0);
  });
});
describe('friendlyLlmError（面向用户的错误提示映射）', () => {
  /** 构造一个带 cause/responseBody/statusCode 的方舟风格错误 */
  const arkErr = (code: string, message: string, status: number): Error => {
    const e = new Error(message) as Error & {
      cause?: unknown;
      responseBody?: string;
      statusCode?: number;
    };
    e.cause = { code, message };
    e.responseBody = JSON.stringify({ error: { code, message } });
    e.statusCode = status;
    return e;
  };

  it('账号欠费 → 提示额度不可用（不含 Request id / status / 技术 code）', () => {
    const e = arkErr(
      'AccountOverdueError',
      'The request failed because your account has an overdue balance. Request id: 02178...',
      403,
    );
    expect(classifyLlmError(e)).toBe('quota');
    const msg = friendlyLlmError(e, '核心结论');
    expect(msg).toContain('核心结论');
    expect(msg).toContain('额度');
    // 不泄漏技术痕迹
    expect(msg).not.toMatch(/Request id|status=|AccountOverdueError|\{"/);
  });

  it('限流 / 超时 / 内容过滤 / 鉴权 各自映射到对应文案', () => {
    expect(classifyLlmError(arkErr('RateLimitExceeded', 'too many requests', 429))).toBe(
      'rate_limit',
    );
    expect(classifyLlmError(new Error('request timeout'))).toBe('timeout');
    expect(classifyLlmError(new Error('content filter blocked the output'))).toBe('content_filter');
    expect(classifyLlmError(arkErr('AuthenticationError', 'invalid api key', 401))).toBe('auth');
  });

  it('未知错误回落通用文案，且仍带章节标题', () => {
    const msg = friendlyLlmError(new Error('some weird internal thing'), '关键数据');
    expect(msg).toContain('关键数据');
    expect(msg).toMatch(/异常|重试/);
  });

  it('streamCustom(throwOnError) 上抛的是友好文案，原始错误保留在 cause', async () => {
    const overdue = arkErr(
      'AccountOverdueError',
      'The request failed because your account has an overdue balance. Request id: 02178abc',
      403,
    );
    (streamText as any).mockResolvedValue({
      fullStream: (async function* () {
        yield { type: 'error', error: overdue };
      })(),
      usage: Promise.resolve({ totalTokens: 0 }),
    });
    const svc = new GenerateService(cfg({ ARK_API_KEY: 'x' }), metrics());
    await expect(
      svc.streamCustom(
        {
          system: 's',
          prompt: 'p',
          fallbackText: '',
          throwOnError: true,
          friendlyErrorHeading: '核心结论',
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow(/核心结论.*额度/);
  });
});
