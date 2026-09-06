import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import type { SearchHit } from '../connectors/connector.interface';
import { MetricsService } from '../../../common/observability/metrics.service';

/** rerank 超时（毫秒）：超时放弃精排回退 RRF 排序，不拖慢首包 */
const RERANK_TIMEOUT_MS = 3_000;

/** 单条候选拼入 prompt 的摘要截断长度（title+snippet 足够判断相关性） */
const SNIPPET_LIMIT = 200;

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
 * - 复用方舟 DeepSeek（OpenAI 兼容）generateText 单次调用；
 * - 无 Key / 超时(3s) / 输出解析失败 → 返回 null，调用方回退 RRF 原序（降级链与全项目一致）；
 * - 指标：llm_calls_total{scene="rerank", status=ok|error|skipped}。
 */
@Injectable()
export class RerankService {
  private readonly logger = new Logger(RerankService.name);
  /** 方舟模型客户端（OpenAI 兼容，与 GenerateService 同源配置） */
  private readonly client: any;
  private readonly enabled: boolean;

  constructor(
    config: ConfigService,
    private readonly metrics: MetricsService,
  ) {
    const baseURL = config.get<string>('ARK_BASE_URL') ?? 'https://ark.cn-beijing.volces.com/api/v3';
    const apiKey = config.get<string>('ARK_API_KEY') ?? '';
    this.enabled = Boolean(apiKey);
    this.client = createOpenAI({ baseURL, apiKey })(config.get<string>('LLM_MODEL') ?? 'deepseek-v4-pro-ga-260813');
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
    try {
      const { text } = await generateText({
        model: this.client,
        prompt: buildRerankPrompt(question, hits),
        abortSignal: linked,
      });
      const order = parseRerankOutput(text);
      if (!order) {
        this.metrics.llmCall('rerank', 'error');
        this.logger.warn(`rerank 输出解析失败，回退 RRF 排序：${text.slice(0, 80)}`);
        return null;
      }
      this.metrics.llmCall('rerank', 'ok');
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
