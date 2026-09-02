import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/session-auth.guard';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import type {
  ConnectorInput,
  SearchConditions,
  SearchHit,
  SearchMode,
  SourceType,
} from './connectors/connector.interface';
import { SearchService } from './search.service';
import { IntentService } from './intent/intent.service';
import { GenerateService } from './generate/generate.service';
import { SearchStoreService } from './persistence/search.store.service';
import { KbService } from '../kb/kb.service';
import { QuotaService } from '../member/quota.service';
import { MetricsService } from '../../common/observability/metrics.service';
import { getRequestId } from '../../common/observability/request-context';
import { withSpan } from '../../common/observability/tracer';
import {
  serializeSse,
  type SseCondFill,
  type SseDone,
  type SseError,
  type SseReportChunk,
  type SseSource,
  type SseStage,
} from './sse/sse.events';

/** 智搜分页默认值 */
const DEFAULT_PAGE_SIZE = 10;
/** 最大单页条数 */
const MAX_PAGE_SIZE = 50;

/** 三模式路由：各模式允许参与的检索路（M3.3 起本地路真实生效） */
const ROUTES_BY_MODE: Record<SearchMode, ReadonlySet<SourceType>> = {
  hybrid: new Set<SourceType>(['web', 'vertical', 'local']),
  web: new Set<SourceType>(['web', 'vertical']),
  local: new Set<SourceType>(['local']),
};

/** 安全解析 conditions JSON（失败回退空对象，不阻断管道） */
function parseConditions(raw?: string): SearchConditions {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? (obj as SearchConditions) : {};
  } catch {
    return {};
  }
}

/** 智搜来源存入知识库入参 */
export interface SaveToKbBody {
  /** 勾选来源的序号（即报告内 idx，与 SSE 来源卡编号一致） */
  idxs?: unknown;
  libraryId?: string;
  groupId?: string | null;
  visibility?: string;
  tags?: unknown;
}

/**
 * 智搜控制器（M2 核心：GET /search/stream 一次请求 → SSE 长连接 → 五阶段事件流式推送）。
 * 阶段：intent(意图分类) → searching(检索) → fusing(融合) → generating(LLM 流式生成) → done；
 * 会话/报告/来源/用量落库(M2.3)，客户端断开 → AbortController 全链路取消。
 * M3.4：save-kb 桩替换为真实入库链路（勾选来源逐条存入知识库，待审核）。
 */
@Controller('search')
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly intent: IntentService,
    private readonly generate: GenerateService,
    private readonly store: SearchStoreService,
    private readonly kb: KbService,
    private readonly quota: QuotaService,
    private readonly metrics: MetricsService,
  ) {}

  @Get('stream')
  async stream(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Query('question') question = '',
    @Query('mode') mode: SearchMode = 'hybrid',
    @Query('conditions') conditionsJson?: string,
  ): Promise<void> {
    const user = req.user!;
    // 敏感词前置拦截（D8/M6.3）：命中启用敏感词即阻断该次检索并落审计，
    // 必须在 SSE 响应头写出前拦截，前端才能按统一业务码提示。
    const blocked = await this.store.checkSensitiveWord(question);
    if (blocked) {
      throw new BizException(ErrorCode.FORBIDDEN, '内容包含敏感词，本次检索已拦截', HttpStatus.FORBIDDEN);
    }
    // 免费体验配额拦截（M5.3）：非会员仅 1 次；必须在 SSE 响应头写出前拦截，
    // 否则配额耗尽只能以 SSE error 事件表达，前端无法统一按业务码弹开通引导。
    await this.quota.consumeTrial(user.userId, user.roles);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    this.metrics.sseOpen();

    const ac = new AbortController();
    res.on('close', () => ac.abort());

    const send = (event: Parameters<typeof serializeSse>[0], data: unknown) =>
      res.write(serializeSse(event, data));

    try {
      await withSpan(
        'search.pipeline',
        {
          'search.mode': mode,
          'search.question_len': question.length,
          'request.id': getRequestId() ?? '',
        },
        async () => {
          await this.runPipeline(req, res, send, ac, { question, mode, conditionsJson });
        },
      );
    } finally {
      this.metrics.sseClose(ac.signal.aborted);
      res.end();
    }
  }

  /** 五阶段管道主体（intent → 检索 → 融合 → 生成 → 落库），异常以 SSE error 事件表达 */
  private async runPipeline(
    req: AuthenticatedRequest,
    res: Response,
    send: (event: Parameters<typeof serializeSse>[0], data: unknown) => void,
    ac: AbortController,
    input: { question: string; mode: SearchMode; conditionsJson?: string },
  ): Promise<void> {
    const user = req.user!;
    const { question, mode, conditionsJson } = input;

    let stage: SseStage['stage'] = 'intent';
    let reportId = '';

    try {
      // 意图阶段：分类 → 条件回填（手动条件优先）
      send('stage', { stage, msg: '理解意图中' } satisfies SseStage);
      const manual: SearchConditions = parseConditions(conditionsJson);
      const ai = await this.intent.classify(question, ac.signal);
      const conditions = IntentService.mergeConditions(manual, ai);

      // 先落会话（拿到 sessionId，供 done/历史使用），条件快照一并保存
      const session = await this.store.createSession(user.userId, question, mode, conditions);
      send('cond_fill', { conditions } satisfies SseCondFill);

      // 检索 + 融合（按模式路由检索路）
      stage = 'searching';
      send('stage', { stage, msg: '检索中' } satisfies SseStage);
      const input: ConnectorInput = { question, conditions };
      const result = await this.search.search(input, ac.signal, undefined, ROUTES_BY_MODE[mode]);

      // 搜索词统计（A-10）：每次检索累计频次，无结果时累计 emptyCount（平台级公共表）
      await this.store.trackSearchTerm(question, result.cited.length + result.referenced.length === 0);

      stage = 'fusing';
      send('stage', { stage, msg: '融合中' } satisfies SseStage);

      // 按 idx 连续编号推送来源卡，并收集（引用级进上下文，参考级仅展示）
      const sources: Array<{ hit: SearchHit; idx: number; isCited: boolean }> = [];
      let idx = 0;
      for (const hit of result.cited) {
        send('source', {
          idx,
          title: hit.title,
          url: hit.url,
          snippet: hit.snippet,
          sourceType: hit.sourceType,
          isCited: true,
        } satisfies SseSource);
        sources.push({ hit, idx: idx++, isCited: true });
      }
      for (const hit of result.referenced) {
        send('source', {
          idx,
          title: hit.title,
          url: hit.url,
          snippet: hit.snippet,
          sourceType: hit.sourceType,
          isCited: false,
        } satisfies SseSource);
        sources.push({ hit, idx: idx++, isCited: false });
      }

      // 生成阶段：LLM 流式正文（引用级来源进上下文）
      stage = 'generating';
      send('stage', { stage, msg: '生成报告中' } satisfies SseStage);
      const generated = await this.generate.stream(
        { question, conditions, sources: result.cited },
        ac.signal,
        (chunk) => send('report_chunk', chunk satisfies SseReportChunk),
      );

      // 落库：报告 + 来源 + 用量
      if (generated.fullText) {
        const saved = await this.store.saveReport(session.id, {
          contentMd: generated.fullText,
          paramsSnapshot: {
            question,
            mode,
            conditions,
            generation: { tokenUsage: generated.tokenUsage },
          },
          tokenUsage: generated.tokenUsage,
          sources,
        });
        reportId = saved.id;
        await this.store.upsertUsage(user.userId, generated.tokenUsage);
      }

      send('stage', { stage: 'done' } satisfies SseStage);
      send('done', { sessionId: session.id, reportId } satisfies SseDone);
    } catch (e) {
      send('error', {
        message: e instanceof Error ? e.message : 'unknown error',
        stage,
      } satisfies SseError);
    }
  }

  @Get('histories')
  @HttpCode(200)
  async histories(
    @Req() req: AuthenticatedRequest,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = String(DEFAULT_PAGE_SIZE),
  ): Promise<{ items: unknown[]; total: unknown; page: number }> {
    const p = Math.max(1, Number(page) || 1);
    const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE));
    const items = await this.store.listSessions(req.user!.userId, p, size);
    return { items, total: items.length, page: p };
  }

  @Get('reports/:id')
  @HttpCode(200)
  reportDetail(@Req() _req: AuthenticatedRequest, @Param('id') id: string): Promise<unknown> {
    return this.store.reportDetail(id);
  }

  /**
   * 智搜勾选来源存入知识库（M3.4）：每条来源独立生成一份 Markdown 文档，
   * 落目标库/分组，状态 PENDING 待审核；审核通过后自动学习（管理端雏形接口）。
   */
  @Post('reports/:id/save-kb')
  @HttpCode(HttpStatus.CREATED)
  async saveToKb(
    @Param('id') sessionId: string,
    @Body() body: SaveToKbBody,
  ): Promise<unknown> {
    const idxs = Array.isArray(body?.idxs)
      ? [...new Set(body.idxs.map(Number).filter((n) => Number.isInteger(n) && n >= 0))]
      : [];
    if (!idxs.length) {
      throw new BizException(ErrorCode.VALIDATION_FAILED, '请先勾选要存入的来源', HttpStatus.BAD_REQUEST);
    }
    if (!body?.libraryId || typeof body.libraryId !== 'string') {
      throw new BizException(ErrorCode.PARAM_MISSING, '缺少目标知识库', HttpStatus.BAD_REQUEST);
    }
    // 会话归属校验与来源读取（跨租户/不存在 → 404）
    const detail = await this.store.reportDetail(sessionId);
    const selected = detail.sources
      .filter((s) => idxs.includes(s.idx))
      .map((s) => ({
        idx: s.idx,
        title: s.title,
        url: s.url ?? null,
        snippet: s.snippet,
        sourceType: s.sourceType,
      }));
    if (!selected.length) {
      throw new BizException(ErrorCode.VALIDATION_FAILED, '所选来源不存在于该报告', HttpStatus.BAD_REQUEST);
    }
    const snap = (detail.paramsSnapshot ?? {}) as { question?: string };
    const tags = Array.isArray(body.tags)
      ? body.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).slice(0, 10)
      : [];
    return this.kb.saveSourcesToLibrary({
      libraryId: body.libraryId,
      groupId: typeof body.groupId === 'string' && body.groupId ? body.groupId : null,
      visibility: body.visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE',
      tags,
      sessionId,
      question: snap.question ?? null,
      sources: selected,
    });
  }
}