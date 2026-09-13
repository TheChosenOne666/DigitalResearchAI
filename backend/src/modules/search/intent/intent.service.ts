import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { SearchIntentSchema, type SearchIntent } from '@app/shared';
import type { SearchConditions } from '../connectors/connector.interface';
import { MetricsService } from '../../../common/observability/metrics.service';
import { withSpan } from '../../../common/observability/tracer';
import { withThinkingDisabled } from '../fusion/rerank.service';

/** 意图分类超时（毫秒）：flash 关思考后实测 ~2s，10s 余量充足；超时放弃降级原问题直走检索，不阻塞管道 */
const INTENT_TIMEOUT_MS = 10_000;

/** 意图分类 system 提示词：要求直接输出 JSON（推理模型可能附带思考，靠 extractJson 容错） */
const INTENT_SYSTEM =
  '你是「AI 数智研究平台」的检索意图理解引擎。完成两项任务：\n' +
  '1. 查询重写：把用户问题改写为规范、专业、信息完整的检索问题（补全口语化省略、明确指标与时间范围），保持原意不扩展新话题；问题本身已规范时原样返回。\n' +
  '2. 从用户问题中抽取可用于结构化检索的条件。\n' +
  '直接输出一个 JSON 对象，不要输出思考过程、不要 markdown 代码块、不要任何解释文字。\n' +
  'JSON 字段：\n' +
  '- rewrittenQuestion：改写后的检索问题（string，中文）\n' +
  '- countries：涉及的国家/地区（中文名或 ISO3），如「美国」「中国」；无则 []\n' +
  '- indicators：涉及的指标（中文名或 WDI 代码），如「GDP」「人均GDP」；无则 []\n' +
  '- yearFrom / yearTo：时间区间（整数年份）；仅当问题明确提及年份时填写，否则 null\n' +
  '- routeHints：倾向走的检索路；vertical=垂直数据库(如世界银行)、web=联网搜索、local=知识库；无法判断则 []\n' +
  '示例：{"rewrittenQuestion":"比较2023年美国GDP总量及增长率","countries":["美国"],"indicators":["GDP"],"yearFrom":2023,"yearTo":2023,"routeHints":["vertical","web"]}';

/**
 * 从 LLM 输出文本提取 JSON 对象（纯函数，便于单测）。
 * 推理模型可能在 JSON 前输出思考、或用 ```json 围栏包裹，逐级容错：
 * 围栏 → 整段 JSON.parse → 首个 { 到末个 } 子串；均失败返回 null。
 */
export function extractJson(text: string): unknown | null {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1].trim() : text.trim();
  try {
    return JSON.parse(candidate);
  } catch {
    /* 非整段 JSON，继续降级提取 */
  }
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * 意图分类服务（M2.2 + 查询重写增强）：调用方舟 DeepSeek（OpenAI 兼容协议），
 * 一次调用同时产出「结构化检索条件 + 查询重写问题」（重写供检索路提升召回，零额外延迟）。
 * 意图抽取/重写同为轻量语义任务，用轻量模型（INTENT_LLM_MODEL，flash）+ 关思考，与 rerank 同一提速模式。
 * 失败或无 Key 降级为「跳过回填 + 原问题直走检索」。
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
    const model = config.get<string>('INTENT_LLM_MODEL') ?? 'deepseek-v4-flash-ga-260731';
    this.enabled = Boolean(apiKey);
    this.client = createOpenAI({
      baseURL,
      apiKey,
      fetch: withThinkingDisabled(globalThis.fetch),
    })(model);
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
   * 对一个问题做意图分类，返回结构化检索条件与查询重写问题。
   * - 无 ARK_API_KEY：返回空条件 + null 重写（降级，原问题直走检索，不阻断管道）。
   * - 调用失败/超时：同上降级并 warn。
   * - 重写问题缺省/为空：rewrittenQuestion 为 null，调用方回退原问题。
   * @param question 用户原始问题
   * @param signal 外部 AbortSignal（客户端断开时取消）
   */
  async classify(
    question: string,
    signal: AbortSignal,
  ): Promise<SearchConditions & { rewrittenQuestion: string | null }> {
    if (!this.enabled) {
      this.logger.warn('ARK_API_KEY 未配置，意图分类降级：跳过条件回填，原问题直走检索');
      return { rewrittenQuestion: null };
    }
    try {
      // 客户端断开或超时任一触发即取消；超时降级为空条件（原问题直走检索），LLM 挂起不拖死管道
      const linked = AbortSignal.any([signal, AbortSignal.timeout(INTENT_TIMEOUT_MS)]);
      // 用 streamText（流式）而非 generateText（非流式）：后者对方舟推理模型的 reasoning output 类型校验失败
      // （AI SDK 4.0.50 响应 schema 不识别 type=reasoning，抛 Invalid JSON response）
      const result = await withSpan('search.intent', { 'search.question_len': question.length }, async () =>
        streamText({
          model: this.client,
          system: INTENT_SYSTEM,
          prompt: question,
          abortSignal: linked,
        }),
      );
      const text = await result.text;
      const raw = extractJson(text);
      if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
        this.metrics.llmCall('intent', 'error');
        this.logger.warn(`意图分类输出非 JSON，降级跳过：${text.slice(0, 80)}`);
        return { rewrittenQuestion: null };
      }
      // yearFrom/yearTo 为 nullable 非 optional，模型可能省略，缺省补 null 保证 schema 通过
      const normalized = { yearFrom: null, yearTo: null, ...(raw as Record<string, unknown>) };
      const parsed = SearchIntentSchema.safeParse(normalized);
      if (!parsed.success) {
        this.metrics.llmCall('intent', 'error');
        this.logger.warn(`意图分类 schema 校验失败，降级跳过：${parsed.error.message}`);
        return { rewrittenQuestion: null };
      }
      this.metrics.llmCall('intent', 'ok');
      const rewritten = parsed.data.rewrittenQuestion?.trim();
      if (rewritten && rewritten !== question) {
        this.logger.log(`查询重写："${question}" → "${rewritten.slice(0, 60)}"`);
      }
      return { ...toConditions(parsed.data), rewrittenQuestion: rewritten || null };
    } catch (e) {
      this.metrics.llmCall('intent', 'error');
      this.logger.warn(`意图分类失败，降级跳过：${e instanceof Error ? e.message : e}`);
      return { rewrittenQuestion: null };
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
