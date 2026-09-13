import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import type { SearchHit } from '../connectors/connector.interface';
import { MetricsService } from '../../../common/observability/metrics.service';

/** rerank 超时（毫秒）：轻量模型关思考后实测 ~1.4s，8s 余量充足；超时放弃精排回退 RRF 排序，不拖慢首包 */
const RERANK_TIMEOUT_MS = 8_000;

/** 单条候选拼入 prompt 的摘要截断长度（title+snippet 足够判断相关性） */
const SNIPPET_LIMIT = 200;

/**
 * 包装 fetch：向方舟请求 body 注入 `thinking: disabled` 关闭混合推理模型的思考模式。
 * listwise 排序是轻量语义匹配，思考耗时占大头且无质量收益（实测 30s → 1.4s）；
 * 仅用于 rerank 客户端，不影响 intent/generate（AI SDK 的 providerOptions 不透传该参数）。
 */
export function withThinkingDisabled(fetchFn: typeof fetch): typeof fetch {
  return (input, init) => {
    if (typeof init?.body === 'string') {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        if (body && typeof body === 'object' && !('thinking' in body)) {
          init = { ...init, body: JSON.stringify({ ...body, thinking: { type: 'disabled' } }) };
        }
      } catch {
        // body 非纯 JSON 时按原样发送
      }
    }
    return fetchFn(input, init);
  };
}

/**
 * 从 LLM 输出文本提取 JSON 数组（纯函数，便于单测）：
 * 容忍 ```json 围栏与前后缀文本；提取失败返回 null。
 */
export function parseRerankOutput(text: string): number[] | null {
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) return null;
  try {
    const arr = JSON.parse(match[0]) as unknown[];
    if (!Array.isArray(arr) || !arr.length) return null;
    const nums = arr.map(Number).filter((n) => Number.isInteger(n) && n >= 1);
    return nums.length ? [...new Set(nums)] : null;
  } catch {
    return null;
  }
}

/**
 * 构建 listwise 精排 prompt（纯函数，便于单测）：
 * 候选按 1 起编号（title+snippet），要求仅输出降序编号 JSON 数组。
 */
export function buildRerankPrompt(question: string, hits: SearchHit[]): string {
  const lines = hits.map((h, i) => {
    const snippet = h.snippet.slice(0, SNIPPET_LIMIT).replace(/\s+/g, ' ');
    return `[${i + 1}] ${h.title}：${snippet}`;
  });
  return (
    `用户问题：${question}\n\n候选资料：\n${lines.join('\n')}\n\n` +
    '请按「与回答该问题的相关性」从高到低对候选资料排序，' +
    '仅输出一个 JSON 数组，元素为资料编号（1 起），不要输出任何其他文字。'
  );
}

/**
 * LLM listwise 精排服务（检索优化 C）：融合 RRF 后对 TopK 做一次语义精排，
 * 替代「rerank 降级版」的纯排名粗排。
 * - 复用方舟 DeepSeek（OpenAI 兼容）streamText 单次调用，专用轻量模型（RERANK_LLM_MODEL，
 *   与生成的 LLM_MODEL 解耦）并关闭思考模式：排序任务无需深度推理，推理模型思考占满 30s 超时；
 * - 无 Key / 超时(8s) / 输出解析失败 → 返回 null，调用方回退 RRF 原序（降级链与全项目一致）；
 * - 指标：llm_calls_total{scene="rerank", status=ok|error|skipped}。
 */
@Injectable()
export class RerankService {
  private readonly logger = new Logger(RerankService.name);
  /** 方舟模型客户端（OpenAI 兼容，rerank 专用轻量模型 + 关思考 fetch） */
  private readonly client: any;
  private readonly enabled: boolean;

  constructor(
    config: ConfigService,
    private readonly metrics: MetricsService,
  ) {
    const baseURL = config.get<string>('ARK_BASE_URL') ?? 'https://ark.cn-beijing.volces.com/api/v3';
    const apiKey = config.get<string>('ARK_API_KEY') ?? '';
    this.enabled = Boolean(apiKey);
    const model = config.get<string>('RERANK_LLM_MODEL') ?? 'deepseek-v4-flash-ga-260731';
    this.client = createOpenAI({
      baseURL,
      apiKey,
      fetch: withThinkingDisabled(globalThis.fetch),
    })(model);
  }

  /**
   * 精排：返回按相关性降序重排后的命中列表；
   * 无法精排（未启用/超时/解析失败）返回 null，调用方继续用原序。
   * @param question 用户问题
   * @param hits 融合后候选（调用方已截 TopK）
   * @param signal 外部 AbortSignal（客户端断开联动取消）
   */
  async rerank(
    question: string,
    hits: SearchHit[],
    signal?: AbortSignal,
  ): Promise<SearchHit[] | null> {
    if (!this.enabled || hits.length < 2) {
      this.metrics.llmCall('rerank', 'skipped');
      return null;
    }

    const timeout = AbortSignal.timeout(RERANK_TIMEOUT_MS);
    const linked = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const startedAt = Date.now();
    try {
      // 用 streamText（流式）而非 generateText（非流式）：后者对方舟推理模型的 reasoning output 类型校验失败
      // （AI SDK 4.0.50 响应 schema 不识别 type=reasoning，抛 Invalid JSON response）
      const result = streamText({
        model: this.client,
        prompt: buildRerankPrompt(question, hits),
        abortSignal: linked,
      });
      const text = await result.text;
      const order = parseRerankOutput(text);
      if (!order) {
        this.metrics.llmCall('rerank', 'error');
        this.logger.warn(`rerank 输出解析失败，回退 RRF 排序：${text.slice(0, 80)}`);
        return null;
      }
      this.metrics.llmCall('rerank', 'ok');
      this.logger.log(`rerank 精排完成：${hits.length} 条候选，耗时 ${Date.now() - startedAt}ms`);
      // LLM 遗漏的编号按原序补尾（保证结果完整且无重复）
      const rest = hits.map((_, i) => i + 1).filter((n) => !order.includes(n));
      return [...order, ...rest]
        .filter((n) => n >= 1 && n <= hits.length)
        .map((n) => hits[n - 1]);
    } catch (e) {
      this.metrics.llmCall('rerank', 'error');
      this.logger.warn(`rerank 调用失败，回退 RRF 排序：${(e as Error).message}`);
      return null;
    }
  }
}
