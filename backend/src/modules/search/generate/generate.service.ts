import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import type { SearchConditions, SearchHit } from '../connectors/connector.interface';

/** 流式正文分片（citations 为本片段出现的 {c:N} 编号） */
export interface GenerateChunk {
  text: string;
  citations: number[];
}

/** 生成请求（引用级来源已按 {c:N} 编号进上下文） */
export interface GenerateRequest {
  question: string;
  conditions: SearchConditions;
  /** 引用级来源（contentMd 进上下文） */
  sources: SearchHit[];
}

/** 生成结果（供落库） */
export interface GenerateResult {
  fullText: string;
  tokenUsage: number;
  citations: number[];
}

const CITATION_PATTERN = /\{c:(\d+)\}/g;

/** 解析文本片段中出现的引文编号 {c:N} */
export function parseCitations(text: string): number[] {
  const out: number[] = [];
  let m: RegExpExecArray | null;
  const re = CITATION_PATTERN;
  while ((m = re.exec(text)) !== null) out.push(Number(m[1]));
  return out;
}

/**
 * 构建生成 prompt：把引用级来源按 {c:N} 编号拼入上下文，
 * 声明报告文体（结构化分析报告，≥准引文脚注）。
 */
export function buildGeneratePrompt(
  question: string,
  conditions: SearchConditions,
  sources: SearchHit[],
): string {
  const ctxLines = sources.map((s, i) => {
    const n = i + 1;
    // kb:// 为本地来源内部去重标识，非真实链接，不进上下文
    const url = s.url && !s.url.startsWith('kb://') ? `（${s.url}）` : '';
    const head = `[${n}] ${s.title}${url}`;
    const body = s.contentMd ? `\n${s.contentMd}` : '';
    return `${head}${body}`;
  });
  const condLine =
    conditions.countries?.length || conditions.indicators?.length
      ? `\n检索条件：国家=${conditions.countries?.join('、') ?? ''}；指标=${conditions.indicators?.join('、') ?? ''}；年份=${conditions.yearFrom ?? ''}-${conditions.yearTo ?? ''}`
      : '';
  return (
    `用户问题：${question}${condLine}\n\n` +
    (ctxLines.length ? `参考资料（按编号引用）：\n${ctxLines.join('\n\n')}` : '（无参考资料，请基于常识作答并标注）')
  );
}

const GENERATE_SYSTEM =
  '你是「AI 数智研究平台」的资深数据分析师，负责把多来源数据整合成一份结构化分析报告。\n' +
  '要求：\n' +
  '- 用 Markdown 输出，含小标题与要点；\n' +
  '- 引用参考资料时在原句后加引文标记 {c:N}（N 为资料编号），不要加脚注列表；\n' +
  '- 数据需给出时间与来源语境，避免泛泛而谈；\n' +
  '- 不做参考资料之外的信息捏造。';

/**
 * LLM 流式报告生成服务（M2.3）：AI SDK streamText 调用方舟 DeepSeek（OpenAI 兼容）。
 * - 输出约定 {c:N} 引文标记 → 前端渲染角标 ↔ 来源卡联动；
 * - 无 ARK_API_KEY 或调用失败 → 降级输出检索结果摘要（不阻断管道）。
 */
@Injectable()
export class GenerateService {
  private readonly logger = new Logger(GenerateService.name);
  private readonly client: any;
  private readonly enabled: boolean;

  constructor(config: ConfigService) {
    const baseURL = config.get<string>('ARK_BASE_URL') ?? 'https://ark.cn-beijing.volces.com/api/v3';
    const apiKey = config.get<string>('ARK_API_KEY') ?? '';
    const model = config.get<string>('LLM_MODEL') ?? 'deepseek-v4-pro-ga-260813';
    this.enabled = Boolean(apiKey);
    this.client = createOpenAI({ baseURL, apiKey })(model);
  }

  /**
   * 流式生成报告：每产生一个分片即回调 onChunk。
   * @param req 生成请求（问题/条件/引用级来源）
   * @param signal 外部 AbortSignal（客户端断开时取消 LLM 流）
   * @param onChunk 分片回调（控制器据此推送 report_chunk SSE 事件）
   */
  async stream(
    req: GenerateRequest,
    signal: AbortSignal,
    onChunk: (chunk: GenerateChunk) => void,
  ): Promise<GenerateResult> {
    return this.streamCustom(
      {
        system: GENERATE_SYSTEM,
        prompt: buildGeneratePrompt(req.question, req.conditions, req.sources),
        fallbackText: buildSearchFallback(req),
      },
      signal,
      onChunk,
    );
  }

  /**
   * 通用流式生成（M4.3 分析结果页复用）：显式指定 system/prompt 与降级文本，
   * 其余逻辑（LLM 调用、逐分片回调、无 Key/失败降级）与智搜一致。
   * @param input system 提示词、user prompt、无 Key/失败时的降级正文
   */
  async streamCustom(
    input: { system: string; prompt: string; fallbackText: string },
    signal: AbortSignal,
    onChunk: (chunk: GenerateChunk) => void,
  ): Promise<GenerateResult> {
    if (!this.enabled) {
      this.logger.warn('ARK_API_KEY 未配置，流式生成降级：输出降级正文');
      return this.fallback(input.fallbackText, onChunk);
    }
    try {
      const { textStream, usage } = await streamText({
        model: this.client,
        system: input.system,
        prompt: input.prompt,
        abortSignal: signal,
      });
      let fullText = '';
      const citations: number[] = [];
      for await (const delta of textStream) {
        fullText += delta;
        const cites = parseCitations(delta);
        citations.push(...cites);
        onChunk({ text: delta, citations: cites });
      }
      const u = await Promise.resolve(usage).catch(() => null);
      return { fullText, tokenUsage: u?.totalTokens ?? 0, citations };
    } catch (e) {
      this.logger.warn(`流式生成失败，降级：${e instanceof Error ? e.message : e}`);
      return this.fallback(input.fallbackText, onChunk);
    }
  }

  /** 无 Key/失败降级：输出降级正文，至少给前端可渲染内容 */
  private fallback(text: string, onChunk: (c: GenerateChunk) => void): GenerateResult {
    onChunk({ text, citations: [] });
    return { fullText: text, tokenUsage: 0, citations: [] };
  }
}

/** 智搜降级正文（检索结果摘要），供 stream 无 Key/失败时输出 */
export function buildSearchFallback(req: GenerateRequest): string {
  const items = req.sources.map(
    (s, i) => `${i + 1}. ${s.title}${s.url && !s.url.startsWith('kb://') ? `（${s.url}）` : ''}`,
  );
  return (
    `## 检索结果摘要\n\n**问题**：${req.question}\n\n已检索到 ${req.sources.length} 条相关来源：\n\n${items.join('\n') || '（暂无可引用来源）'}\n`
  );
}