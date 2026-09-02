import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { SearchIntentSchema, type SearchIntent } from '@app/shared';
import type { SearchConditions } from '../connectors/connector.interface';
import { MetricsService } from '../../../common/observability/metrics.service';
import { withSpan } from '../../../common/observability/tracer';

/**
 * 意图分类服务（M2.2）：调用方舟 DeepSeek（OpenAI 兼容协议）做结构化抽取，
 * 把用户问题转成检索条件（国家/指标/年份/检索倾向）。失败或无 Key 降级为「跳过回填」。
 */
@Injectable()
export class IntentService {
  private readonly logger = new Logger(IntentService.name);
  private readonly client: any;
  private readonly enabled: boolean;

  constructor(
    config: ConfigService,
    private readonly metrics: MetricsService,
  ) {
    const baseURL = config.get<string>('ARK_BASE_URL') ?? 'https://ark.cn-beijing.volces.com/api/v3';
    const apiKey = config.get<string>('ARK_API_KEY') ?? '';
    const model = config.get<string>('LLM_MODEL') ?? 'deepseek-v4-pro-ga-260813';
    this.enabled = Boolean(apiKey);
    this.client = createOpenAI({ baseURL, apiKey })(model);
  }

  /** 合并条件：手动条件优先（非空覆盖 AI 结果） */
  static mergeConditions(manual: SearchConditions, ai: SearchConditions): SearchConditions {
    return {
      countries: manual.countries?.length ? manual.countries : ai.countries,
      indicators: manual.indicators?.length ? manual.indicators : ai.indicators,
      yearFrom: manual.yearFrom ?? ai.yearFrom,
      yearTo: manual.yearTo ?? ai.yearTo,
      routeHints: manual.routeHints?.length ? manual.routeHints : ai.routeHints,
    };
  }

  /**
   * 对一个问题做意图分类，返回结构化检索条件。
   * - 无 ARK_API_KEY：直接返回空条件（降级，不阻断管道）。
   * - 调用失败/超时：返回空条件并 warn（降级）。
   * @param question 用户原始问题
   * @param signal 外部 AbortSignal（客户端断开时取消）
   */
  async classify(question: string, signal: AbortSignal): Promise<SearchConditions> {
    if (!this.enabled) {
      this.logger.warn('ARK_API_KEY 未配置，意图分类降级：跳过条件回填，原问题直走检索');
      return {};
    }
    try {
      const { object } = await withSpan('search.intent', { 'search.question_len': question.length }, async () =>
        generateObject({
          model: this.client,
          // 规避 AI SDK 对 ZodDefault 嵌套 schema 的深层类型推断（TS2589）
          schema: SearchIntentSchema as any,
          system:
            '你是「AI 数智研究平台」的检索意图理解引擎。从用户问题中抽取可用于结构化检索的条件：\n' +
            '- countries：涉及的国家/地区（中文名或 ISO3），如「美国」「中国」；无则空数组\n' +
            '- indicators：涉及的指标（中文名或 WDI 代码），如「GDP」「人均GDP」；无则空数组\n' +
            '- yearFrom / yearTo：时间区间；仅当问题明确提及年份时填写，否则 null\n' +
            '- routeHints：倾向走的检索路；vertical=垂直数据库(如世界银行)、web=联网搜索、local=知识库；无法判断则空数组\n' +
            '只输出符合 schema 的 JSON，不要任何解释文字。',
          prompt: question,
          abortSignal: signal,
        }),
      );
      this.metrics.llmCall('intent', 'ok');
      return toConditions(object as SearchIntent);
    } catch (e) {
      this.metrics.llmCall('intent', 'error');
      this.logger.warn(`意图分类失败，降级跳过：${e instanceof Error ? e.message : e}`);
      return {};
    }
  }
}

/** SearchIntent → SearchConditions（去掉意图概述冗余字段） */
function toConditions(intent: SearchIntent): SearchConditions {
  return {
    countries: intent.countries,
    indicators: intent.indicators,
    yearFrom: intent.yearFrom,
    yearTo: intent.yearTo,
    routeHints: intent.routeHints,
  };
}
