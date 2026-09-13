import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/session-auth.guard';
import { BizException } from '../../common/exceptions/biz.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ErrorCode, SearchStreamSchema, type SearchStreamBody, SearchGenerateSchema, type SearchGenerateBody } from '@app/shared';
import type {
  ConnectorInput,
  SearchHit,
  SearchMode,
  SourceType,
} from './connectors/connector.interface';
import { SearchService, DEFAULT_LOCAL_FIRST } from './search.service';
import type { FusionResult } from './fusion/fusion.service';
import { IntentService } from './intent/intent.service';
import {
  GenerateService,
  REPORT_SECTIONS,
  describeLlmError,
  friendlyLlmError,
} from './generate/generate.service';
import { SearchStoreService, type ReportSegmentRow } from './persistence/search.store.service';
import { SearchUploadService } from './upload/search-upload.service';
import { SearchTaskService } from './task/search-task.service';
import { SearchCacheService } from './search-cache.service';
import { RerankService } from './fusion/rerank.service';
import { KbService } from '../kb/kb.service';
import { QuotaService } from '../member/quota.service';
import { MetricsService } from '../../common/observability/metrics.service';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import { getRequestId } from '../../common/observability/request-context';
import { getTenantContext } from '../../common/auth/tenant-context';
import { withSpan } from '../../common/observability/tracer';
import { startSseHeartbeat } from '../../common/sse/sse-heartbeat.util';
import {
  checkOutput,
  detectInjection,
  normalizeText,
} from '../../common/security/prompt-guard';
import {
  serializeSse,
  type SseCondFill,
  type SseDone,
  type SseError,
  type SseReportChunk,
  type SseSearchRoute,
  type SseSectionDone,
  type SseSource,
  type SseSourcesReady,
  type SseStage,
} from './sse/sse.events';
import { RETRIEVAL_TTL_SECONDS } from './search.constants';

/** 智搜分页默认值 */
const DEFAULT_PAGE_SIZE = 10;
/** 最大单页条数 */
const MAX_PAGE_SIZE = 50;

/** L4 输出兜底命中高危时替换报告的正文 */
const OUTPUT_BLOCKED_TEXT = '（本次生成内容触发安全校验，已被拦截，请调整问题后重试）';

/** 三模式路由：各模式允许参与的检索路（M3.3 起本地路真实生效）
 *  注意：hybrid 不走此表，改用「知识库优先 + 串行兜底」（18 智搜增强），此处条目仅作语义留档 */
const ROUTES_BY_MODE: Record<SearchMode, ReadonlySet<SourceType>> = {
  hybrid: new Set<SourceType>(['web', 'vertical', 'local']),
  web: new Set<SourceType>(['web', 'vertical']),
  local: new Set<SourceType>(['local']),
};

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
  private readonly logger = new Logger(SearchController.name);

  constructor(
    private readonly search: SearchService,
    private readonly intent: IntentService,
    private readonly generate: GenerateService,
    private readonly store: SearchStoreService,
    private readonly cache: SearchCacheService,
    private readonly rerank: RerankService,
    private readonly kb: KbService,
    private readonly quota: QuotaService,
    private readonly metrics: MetricsService,
    private readonly rateLimit: RateLimitService,
    private readonly config: ConfigService,
    /** 18 批 3：智搜补充上传的本地资料（加载为来源前置并入） */
    private readonly upload: SearchUploadService,
    /** 18 批 4：任务管控（检索/生成任务状态 + 断点续跑） */
    private readonly task: SearchTaskService,
  ) {}

  @Post('stream')
  @HttpCode(200)
  async stream(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Body(new ZodValidationPipe(SearchStreamSchema)) body: SearchStreamBody,
  ): Promise<void> {
    const { mode, conditions } = body;
    const user = req.user!;
    // L1 归一化：NFKC + 移除零宽/双向控制字符，消除编码变体绕过；后续检测与 LLM 统一用归一化文本
    const question = normalizeText(body.question);
    // L3 检测分级（规则引擎）：高危注入模板直接阻断（SSE 头写出前，前端按统一业务码提示）
    const inject = detectInjection(question);
    if (inject.level === 'high') {
      this.logger.warn(`提示词注入拦截: rules=${inject.reasons.join(',')} userId=${user.userId}`);
      throw new BizException(ErrorCode.FORBIDDEN, '输入包含异常内容，本次检索已拦截', HttpStatus.FORBIDDEN);
    } else if (inject.level === 'medium') {
      // 中风险仅记观测日志放行（纯规则方案下无 LLM 二次判别），供后续规则迭代参考
      this.logger.warn(`提示词注入中风险: rules=${inject.reasons.join(',')} userId=${user.userId}`);
    }
    // 敏感词前置拦截（D8/M6.3）：命中启用敏感词即阻断该次检索并落审计，
    // 必须在 SSE 响应头写出前拦截，前端才能按统一业务码提示。
    const blocked = await this.store.checkSensitiveWord(question);
    if (blocked) {
      throw new BizException(ErrorCode.FORBIDDEN, '内容包含敏感词，本次检索已拦截', HttpStatus.FORBIDDEN);
    }
    // 免费体验配额拦截（M5.3）：非会员仅 1 次；必须在 SSE 响应头写出前拦截，
    // 否则配额耗尽只能以 SSE error 事件表达，前端无法统一按业务码弹开通引导。
    await this.quota.consumeTrial(user.userId, user.roles);

    // SSE 并发上限（M7.2）：占一个槽位，超限抛 429（发生在 SSE 头写出前，走统一异常响应）
    await this.rateLimit.acquireSseSlot(user.userId);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    this.metrics.sseOpen();

    const ac = new AbortController();
    res.on('close', () => ac.abort());

    // SSE 心跳：空闲期定时写注释帧防网关掐断（SSE_HEARTBEAT_MS 可配，<=0 禁用）
    const stopHeartbeat = startSseHeartbeat(
      res,
      ac,
      this.config.get<number>('SSE_HEARTBEAT_MS', 15_000)!,
    );

    const send = (event: Parameters<typeof serializeSse>[0], data: unknown) =>
      res.write(serializeSse(event, data));

    try {
      const outcome = await withSpan(
        'search.pipeline',
        {
          'search.mode': mode,
          'search.question_len': question.length,
          'request.id': getRequestId() ?? '',
        },
        async () =>
          this.runPipeline(req, res, send, ac, {
            question,
            mode,
            conditions,
            uploadIds: body.uploadIds ?? [],
          }),
      );
      // 管道失败（非用户主动中止）→ 回滚本次试额，避免「搜一次失败扣一次」
      if (outcome === 'error') {
        await this.quota
          .rollbackTrial(user.userId, user.roles)
          .catch((e: unknown) =>
            this.logger.warn(`试额回滚失败: ${e instanceof Error ? e.message : e}`),
          );
      }
    } finally {
      stopHeartbeat();
      await this.rateLimit.releaseSseSlot(user.userId);
      this.metrics.sseClose(ac.signal.aborted);
      res.end();
    }
  }

  /**
   * 两段式第二段：基于检索快照与用户勾选生成报告（17 交互重构）。
   * 仅勾选来源进生成上下文（角标按勾选集合重新连续编号）；未勾选来源落库但标未引用。
   * 不重复计费（第一段检索已扣）、不重复检索（快照命中）。
   */
  @Post('stream/generate')
  @HttpCode(200)
  async generateFromSelection(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Body(new ZodValidationPipe(SearchGenerateSchema)) body: SearchGenerateBody,
  ): Promise<void> {
    const user = req.user!;

    // 快照校验：存在 + 未过期 + 归属当前用户（store 经租户链隔离，跨租户视为不存在）
    const snapshot = await this.store.getRetrieval(body.sessionId);
    if (!snapshot) {
      throw new BizException(ErrorCode.NOT_FOUND, '检索结果不存在或已被清除，请重新检索', HttpStatus.NOT_FOUND);
    }
    const expiresInSeconds = Math.floor(
      RETRIEVAL_TTL_SECONDS - (Date.now() - snapshot.createdAt.getTime()) / 1000,
    );
    if (expiresInSeconds <= 0) {
      throw new BizException(
        ErrorCode.VALIDATION_FAILED,
        `检索结果已过期（超过 ${Math.round(RETRIEVAL_TTL_SECONDS / 60)} 分钟），请重新勾选并点击开始分析`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // 勾选编号校验：必须在快照来源范围内（去重）
    const selectedIdxs = [...new Set(body.selectedIdxs)].sort((a, b) => a - b);
    const validIdxs = new Set(snapshot.sources.map((s) => s.idx));
    if (selectedIdxs.some((n) => !validIdxs.has(n))) {
      throw new BizException(
        ErrorCode.VALIDATION_FAILED,
        `勾选编号越界：有效范围 1-${validIdxs.size}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // SSE 并发上限：与第一段一致（生成也是长连接）
    await this.rateLimit.acquireSseSlot(user.userId);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    this.metrics.sseOpen();

    const ac = new AbortController();
    res.on('close', () => ac.abort());
    const stopHeartbeat = startSseHeartbeat(
      res,
      ac,
      this.config.get<number>('SSE_HEARTBEAT_MS', 15_000)!,
    );
    const send = (event: Parameters<typeof serializeSse>[0], data: unknown) =>
      res.write(serializeSse(event, data));

    /** 任务与报告 id 在 try 内创建：任一步失败也必须走 finally 释放 SSE 槽位与心跳 */
    let genTaskId = '';
    let reportId = '';

    try {
      // 18 批 4：创建生成任务 + 报告草稿（分段生成，中断后可在任务列表「继续生成」）
      genTaskId = await this.task.startGenerate(body.sessionId);
      const draft = await this.store.createDraftReport(body.sessionId, {
        question: snapshot.question,
        mode: snapshot.mode,
        generation: { selectedIdxs },
      });
      reportId = draft.id;

      // 勾选来源按快照原序进入上下文；角标按勾选集合重新连续编号（1 起）
      const selected = snapshot.sources
        .filter((s) => selectedIdxs.includes(s.idx))
        .map((s, i) => ({
          idx: i + 1,
          title: s.title,
          url: s.url ?? undefined,
          snippet: s.snippet,
          sourceType: s.sourceType,
          contentMd: s.contentMd,
        }));
      // 全量来源落库（未勾选也存，标 isCited=false 仅展示）；completeReport 走 hit 包装契约
      const allForSave = snapshot.sources.map((s) => ({
        hit: {
          title: s.title,
          url: s.url ?? undefined,
          snippet: s.snippet,
          sourceType: s.sourceType,
          contentMd: s.contentMd,
        } as SearchHit,
        idx: s.idx,
        isCited: selectedIdxs.includes(s.idx),
      }));

      send('stage', { stage: 'generating', msg: '生成报告中' } satisfies SseStage);

      // 18 批 4：逐章生成；每章即时落库形成断点，章节边界检查中止信号
      const generated = await this.runSectionedGeneration({
        sessionId: body.sessionId,
        question: snapshot.question,
        selected: selected.map((s) => ({
          title: s.title,
          url: s.url ?? undefined,
          snippet: s.snippet,
          sourceType: s.sourceType,
          contentMd: s.contentMd,
        })),
        reportId,
        priorSegments: [],
        taskId: genTaskId,
        send,
        ac,
      });

      // L4 输出兜底（与第一段时代语义一致）：高危替换落库正文
      let finalText = generated.fullText;
      const outCheck = checkOutput(finalText);
      if (outCheck.level === 'high') {
        this.logger.warn(`输出兜底拦截: rules=${outCheck.reasons.join(',')} session=${body.sessionId}`);
        finalText = OUTPUT_BLOCKED_TEXT;
      } else if (outCheck.level === 'medium') {
        this.logger.warn(`输出兜底中风险: rules=${outCheck.reasons.join(',')} session=${body.sessionId}`);
      }

      // 未生成完全部章节（用户中止 / 部分章节失败）→ 保留草稿并把任务置为可续跑态，
      // 不能当作完成落库（否则会把不完整报告标成 COMPLETE 并进入历史）。
      // 判定同时看「失败章数」：单章失败会跳过该章继续后续章节，此时 doneCount 可能
      // 仍等于总章数（如首章失败、后两章成功）——必须靠 failures 才能识别真正未完成。
      if (generated.doneCount < REPORT_SECTIONS.length || generated.failures.length > 0) {
        const failed = generated.failures.length;
        // 失败明细持久化到任务（任务中心可见逐章原因），无失败明细则沿用通用中止文案
        await this.task.markAborted(
          genTaskId,
          failed > 0 ? generated.failures.join('\n') : undefined,
        );
        this.logger.log(
          `生成未完成 session=${body.sessionId} 已完成 ${generated.doneCount}/${REPORT_SECTIONS.length} 章` +
            `（失败 ${failed} 章，草稿保留，可续跑）`,
        );
        // 逐条失败原因单独成行推给前端；无失败明细（如用户中止）则用汇总文案兜底
        send('error', {
          message:
            failed > 0
              ? `生成未完成：已完成 ${generated.doneCount}/${REPORT_SECTIONS.length} 章`
              : `生成已中断（已完成 ${generated.doneCount}/${REPORT_SECTIONS.length} 章），可点击「继续生成」重试`,
          messages: failed > 0 ? generated.failures : undefined,
          taskId: genTaskId,
          stage: 'generating',
        } satisfies SseError);
        return;
      }

      // 全部章节完成 → 转 COMPLETE 并落来源；用量按本次生成累计
      await this.store.completeReport(reportId, {
        contentMd: finalText,
        tokenUsage: generated.tokenUsage,
        sources: allForSave,
      });
      await this.store.upsertUsage(user.userId, generated.tokenUsage);
      await this.task.markDone(genTaskId);
      this.logger.log(
        `报告生成完成 session=${body.sessionId} report=${reportId} 章节=${REPORT_SECTIONS.length} tokens=${generated.tokenUsage}`,
      );

      send('stage', { stage: 'done' } satisfies SseStage);
      send('done', { sessionId: body.sessionId, reportId } satisfies SseDone);
    } catch (e) {
      // 18 批 4：失败/中止时**保留草稿与已完成章节**（任务转对应状态，可「继续生成」）
      const msg = e instanceof Error ? e.message : 'unknown error';
      await this.markTaskFailed(genTaskId, ac.signal.aborted, msg);
      send('error', { message: msg, taskId: genTaskId, stage: 'generating' } satisfies SseError);
    } finally {
      stopHeartbeat();
      await this.rateLimit.releaseSseSlot(user.userId);
      this.metrics.sseClose(ac.signal.aborted);
      res.end();
    }
  }

  /**
   * 18 批 4：继续生成（断点续跑）。
   *
   * 从报告的断点位置继续生成剩余章节：已完成章节直接复用已落库内容，
   * 因此**不会重复生成、不会出现重复段落**，也不重复计费（计费发生在检索段）。
   * 编排复用本控制器的 `runSectionedGeneration`，故该路由与生成路由同处一个控制器。
   */
  @Post('tasks/:id/resume')
  @HttpCode(200)
  async resumeTask(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Param('id') taskId: string,
  ): Promise<void> {
    const user = req.user!;
    // 校验：生成任务 + 中断/失败态（其余状态抛 400/409）
    const task = await this.task.ensureResumable(taskId);

    const draft = await this.store.getDraftReport(task.sessionId);
    if (!draft) {
      throw new BizException(
        ErrorCode.NOT_FOUND,
        '未找到可续跑的报告草稿（可能已重新生成或不存在）',
        HttpStatus.NOT_FOUND,
      );
    }
    // 续跑复用检索快照（不重新检索、不重复扣检索费），因此窗口受快照有效期约束：
    // 过期必须明确拒绝并引导重新检索，不能拿过期数据接着生成。
    // 任务列表通过 `resumableSeconds` 提前暴露该窗口，正常情况下用户不会撞到这里。
    const snapshot = await this.store.getRetrieval(task.sessionId);
    const expired =
      !snapshot || RETRIEVAL_TTL_SECONDS - (Date.now() - snapshot.createdAt.getTime()) / 1000 <= 0;
    if (expired) {
      this.logger.warn(`续跑被拒：检索快照缺失或已过期 task=${taskId} session=${task.sessionId}`);
      throw new BizException(
        ErrorCode.VALIDATION_FAILED,
        `检索结果已过期（超过 ${Math.round(RETRIEVAL_TTL_SECONDS / 60)} 分钟），请重新勾选并点击开始分析`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // 续跑起点以大方向上的断点位置为基准；实际「还需要生成哪些章」由
    // runSectionedGeneration 按「已落库 segment」逐章判断——因此这里直接复用
    // **全部已落库章节**（含上次失败章之后已成功的章），失败章因缺 segment 会被重新生成。
    const maxSegIdx = draft.segments.reduce((max, s) => Math.max(max, s.idx), -1);
    const startIdx = Math.max(draft.segmentIdx, maxSegIdx + 1);
    const priorSegments = draft.segments;

    // 沿用原勾选（存于草稿 paramsSnapshot）
    const snapParams = (draft.paramsSnapshot ?? {}) as {
      generation?: { selectedIdxs?: number[] };
    };
    const selectedIdxs = snapParams.generation?.selectedIdxs ?? [];
    const selectedHits = snapshot.sources
      .filter((s) => selectedIdxs.includes(s.idx))
      .map((s, i) => ({
        idx: i + 1,
        title: s.title,
        url: s.url ?? undefined,
        snippet: s.snippet,
        sourceType: s.sourceType,
        contentMd: s.contentMd,
      }));
    if (!selectedHits.length) {
      throw new BizException(
        ErrorCode.VALIDATION_FAILED,
        '原勾选来源已不可用，请重新检索后生成',
        HttpStatus.BAD_REQUEST,
      );
    }
    const allForSave = snapshot.sources.map((s) => ({
      hit: {
        title: s.title,
        url: s.url ?? undefined,
        snippet: s.snippet,
        sourceType: s.sourceType,
        contentMd: s.contentMd,
      } as SearchHit,
      idx: s.idx,
      isCited: selectedIdxs.includes(s.idx),
    }));

    await this.rateLimit.acquireSseSlot(user.userId);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    this.metrics.sseOpen();

    const ac = new AbortController();
    res.on('close', () => ac.abort());
    const stopHeartbeat = startSseHeartbeat(
      res,
      ac,
      this.config.get<number>('SSE_HEARTBEAT_MS', 15_000)!,
    );
    const send = (event: Parameters<typeof serializeSse>[0], data: unknown) =>
      res.write(serializeSse(event, data));

    try {
      // CAS 抢占：仅当任务仍处于可续跑态才置为进行中——防止重复点击/并发请求双跑
      //（双跑会各自调一次 upsertUsage，造成 token 用量翻倍）
      await this.task.claimForResume(
        taskId,
        Math.round((startIdx / REPORT_SECTIONS.length) * 100),
      );
      this.logger.log(
        `继续生成 session=${task.sessionId} 从第 ${startIdx + 1}/${REPORT_SECTIONS.length} 章开始（已完成 ${startIdx} 章）`,
      );
      send('stage', {
        stage: 'generating',
        msg: `继续生成（已完成 ${draft.segmentIdx}/${REPORT_SECTIONS.length} 章）`,
      } satisfies SseStage);

      const generated = await this.runSectionedGeneration({
        sessionId: task.sessionId,
        question: snapshot.question,
        selected: selectedHits.map((s) => ({
          title: s.title,
          url: s.url ?? undefined,
          snippet: s.snippet,
          sourceType: s.sourceType,
          contentMd: s.contentMd,
        })),
        reportId: draft.id,
        priorSegments,
        taskId,
        send,
        ac,
      });

      let finalText = generated.fullText;
      const outCheck = checkOutput(finalText);
      if (outCheck.level === 'high') {
        this.logger.warn(`输出兜底拦截: rules=${outCheck.reasons.join(',')} session=${task.sessionId}`);
        finalText = OUTPUT_BLOCKED_TEXT;
      }

      // 同样：未生成完全部章节（再次中断 / 部分章节失败）→ 保留草稿，任务回到可续跑态
      if (generated.doneCount < REPORT_SECTIONS.length || generated.failures.length > 0) {
        const failed = generated.failures.length;
        await this.task.markAborted(taskId, failed > 0 ? generated.failures.join('\n') : undefined);
        this.logger.log(
          `续跑未完成 session=${task.sessionId} 已完成 ${generated.doneCount}/${REPORT_SECTIONS.length} 章` +
            `（失败 ${failed} 章）`,
        );
        send('error', {
          message:
            failed > 0
              ? `生成未完成：已完成 ${generated.doneCount}/${REPORT_SECTIONS.length} 章`
              : `生成已中断（已完成 ${generated.doneCount}/${REPORT_SECTIONS.length} 章），可再次继续生成`,
          messages: failed > 0 ? generated.failures : undefined,
          taskId,
          stage: 'generating',
        } satisfies SseError);
        return;
      }

      await this.store.completeReport(draft.id, {
        contentMd: finalText,
        tokenUsage: generated.tokenUsage,
        sources: allForSave,
      });
      await this.store.upsertUsage(user.userId, generated.tokenUsage);
      await this.task.markDone(taskId);
      this.logger.log(`续跑完成 session=${task.sessionId} report=${draft.id}`);

      send('stage', { stage: 'done' } satisfies SseStage);
      send('done', { sessionId: task.sessionId, reportId: draft.id } satisfies SseDone);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown error';
      // 抢占冲突（已有请求在接续该任务）不得改写任务状态，否则会干扰正在跑的那个请求
      const isClaimConflict = e instanceof BizException && e.bizCode === ErrorCode.CONFLICT;
      if (!isClaimConflict) await this.markTaskFailed(taskId, ac.signal.aborted, msg);
      else this.logger.warn(`续跑抢占冲突，忽略本次请求 session=${task.sessionId}`);
      send('error', { message: msg, taskId, stage: 'generating' } satisfies SseError);
    } finally {
      stopHeartbeat();
      await this.rateLimit.releaseSseSlot(user.userId);
      this.metrics.sseClose(ac.signal.aborted);
      res.end();
    }
  }

  /**
   * 逐章生成报告（18 批 4）：按章节顺序生成「尚未成功落库」的章节，每章完成即落库形成断点。
   *
   * 中止语义：在**章节边界**检查「用户断开（ac.signal）」与「任务被请求中止（状态被置 ABORTED）」，
   * 命中则停止后续章节并保留已生成内容——因此续跑不会重复也不会断裂。
   *
   * 失败语义（2026-09-11 修复）：单章 LLM 调用失败**不再整体中断**，而是记录该章失败原因
   * 后跳过该章、继续生成后续章节——这样用户能拿到「哪些章成功、哪些章失败」的完整清单，
   * 而不是只看到第一处失败。失败章节**不落库**，因此续跑时会因为「缺少该章 segment」被重新生成，
   * 已成功章节因 `doneIdxs` 命中而被跳过，既不重复也不留空洞。
   * @returns 累积正文、token 用量、实际完成到第几章、逐章失败明细
   */
  private async runSectionedGeneration(params: {
    sessionId: string;
    question: string;
    selected: SearchHit[];
    reportId: string;
    priorSegments: ReportSegmentRow[];
    taskId: string;
    send: (event: Parameters<typeof serializeSse>[0], data: unknown) => void;
    ac: AbortController;
  }): Promise<{ fullText: string; tokenUsage: number; doneCount: number; failures: string[] }> {
    const { sessionId, question, selected, reportId, priorSegments, taskId, send, ac } = params;
    /**
     * 已成功内容的章节片段。以章序号为键保存，最终按序号排序拼接——
     * 因为续跑时可能「补齐中间的失败章」，其序号小于已有的后置章节，
     * 若按生成顺序拼接会导致正文章节错位。
     */
    const partsByIdx = new Map<number, { heading: string; contentMd: string }>();
    for (const s of priorSegments) partsByIdx.set(s.idx, { heading: s.heading, contentMd: s.contentMd });
    /** 已成功落库的章节序号集合（续跑时跳过，避免重复生成/重复段落） */
    const doneIdxs = new Set(partsByIdx.keys());
    /** 按章节序号排列的已完成片段（拼正文/衔接上下文统一用它） */
    const orderedParts = (): Array<{ heading: string; contentMd: string }> =>
      [...partsByIdx.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    let tokenUsage = 0;
    let doneCount = partsByIdx.size;
    /** 逐章失败明细（每条一句：章节标题 + 原因），最后一次性推给前端换行展示 */
    const failures: string[] = [];

    for (let i = 0; i < REPORT_SECTIONS.length; i++) {
      // 已成功落库的章节直接跳过（含续跑时断点前的章节，以及上次失败的章之前已成功的章）
      if (doneIdxs.has(i)) continue;
      // 章节边界检查点
      if (ac.signal.aborted || (await this.task.isAborted(taskId))) {
        this.logger.log(`生成在章节边界中断 session=${sessionId} 已完成=${doneCount}章`);
        break;
      }
      const section = REPORT_SECTIONS[i];
      // 章节标题先行推送（2026-09-11 修复）：流式正文与最终落库结构一致
      // （## 标题 + 空行，章间空行分隔），各章内容独立成段——否则多章文本
      // （含失败占位）会拼接挤在同一行，前端无法阅读。已有正文时标题前补空行。
      send('report_chunk', {
        text: `${doneCount > 0 ? '\n\n' : ''}## ${section.heading}\n\n`,
        citations: [],
      } satisfies SseReportChunk);
      // 已完成内容的尾部作为衔接上下文（截断，避免上下文膨胀）
      const priorSummary = orderedParts()
        .map((p) => p.contentMd)
        .join('\n\n')
        .slice(-1500);
      let chunk: { fullText: string; tokenUsage: number };
      try {
        chunk = await this.generate.streamSection(
          { question, conditions: {}, sources: selected },
          i,
          priorSummary,
          ac.signal,
          (c) => send('report_chunk', c satisfies SseReportChunk),
        );
      } catch (e) {
        // 本章期间被中止：不是失败，丢弃未定稿内容并停止后续章节
        if (ac.signal.aborted) {
          this.logger.log(`章节 ${i} 执行中被中止，丢弃该章内容 session=${sessionId}`);
          break;
        }
        // 单章失败：记录原因 → 跳过本章 → 继续后续章节（不整体中断）。
        // `streamSection` 上抛的已是友好提示；此处再兜底包装一次，确保无论上层抛什么
        // 都只给用户产品化文案（技术原文仅进日志）。
        const cause = (e as Error & { cause?: unknown }).cause ?? e;
        const reason = friendlyLlmError(e, section.heading);
        failures.push(reason);
        this.logger.warn(
          `章节失败 ${i + 1}/${REPORT_SECTIONS.length}「${section.heading}」session=${sessionId}：` +
            `${describeLlmError(cause)}`,
        );
        continue;
      }
      // 本章期间被中止：丢弃未定稿内容，保留此前章节（chunk 已推给前端但连接已断，无影响）
      if (ac.signal.aborted) {
        this.logger.log(`章节 ${i} 执行后被中止，丢弃该章内容 session=${sessionId}`);
        break;
      }

      partsByIdx.set(i, { heading: section.heading, contentMd: chunk.fullText });
      tokenUsage += chunk.tokenUsage;
      doneIdxs.add(i);
      doneCount = doneIdxs.size;

      // 断点落库：章节内容 + 草稿累积正文 + 断点位置（顺序保证刷新/续跑可恢复）
      const contentMd = this.joinSections(orderedParts());
      await this.store.saveSegment(reportId, i, section.heading, chunk.fullText);
      await this.store.updateDraft(reportId, { segmentIdx: doneCount, contentMd, tokenUsage });
      await this.task.updateProgress(taskId, doneCount, REPORT_SECTIONS.length);
      // 章节完成事件：前端显示「已完成 x/N 章」，也是断点位置对外的可见信号
      send('section_done', {
        idx: i,
        heading: section.heading,
        doneCount,
        total: REPORT_SECTIONS.length,
      } satisfies SseSectionDone);
      this.logger.log(`章节完成 ${i + 1}/${REPORT_SECTIONS.length}「${section.heading}」session=${sessionId}`);
    }

    return { fullText: this.joinSections(orderedParts()), tokenUsage, doneCount, failures };
  }

  /** 章节拼接为报告正文（二级标题 + 正文，章节间空行分隔） */
  private joinSections(parts: Array<{ heading: string; contentMd: string }>): string {
    return parts.map((p) => `## ${p.heading}\n\n${p.contentMd.trim()}`).join('\n\n');
  }

  /** 生成失败/中止的任务状态标记（标记失败不覆盖主流程的异常语义） */
  private async markTaskFailed(taskId: string, aborted: boolean, msg: string): Promise<void> {
    // 任务创建本身失败时 id 为空，无可标记对象（避免用空 id 去更新并打出误导性告警）
    if (!taskId) return;
    try {
      if (aborted) await this.task.markAborted(taskId);
      else await this.task.markFailed(taskId, 'GENERATE_FAILED', msg);
    } catch (e) {
      this.logger.warn(`任务状态标记失败 task=${taskId}：${(e as Error).message}`);
    }
  }

  /** 取检索快照（恢复选择态）：过期返回 200 + expiresInSeconds<=0，前端提示重新检索 */
  @Get('retrievals/:sessionId')
  @HttpCode(200)
  retrieval(@Req() _req: AuthenticatedRequest, @Param('sessionId') sessionId: string): unknown {
    return this.store.getRetrieval(sessionId).then((snapshot) => {
      if (!snapshot) {
        throw new BizException(ErrorCode.NOT_FOUND, '检索结果不存在或已被清除', HttpStatus.NOT_FOUND);
      }
      const expiresInSeconds = Math.floor(
        RETRIEVAL_TTL_SECONDS - (Date.now() - snapshot.createdAt.getTime()) / 1000,
      );
      return {
        sessionId,
        question: snapshot.question,
        mode: snapshot.mode,
        sources: snapshot.sources,
        createdAt: snapshot.createdAt.toISOString(),
        expiresInSeconds,
      };
    });
  }

  /**
   * 五阶段管道主体（intent → 检索 → 融合 → 生成 → 落库），异常以 SSE error 事件表达。
   * @returns 'ok' 完成 | 'error' 管道异常（调用方回滚试额）| 'aborted' 用户主动中止（不回滚，防「点停止白嫖」）
   */
  private async runPipeline(
    req: AuthenticatedRequest,
    res: Response,
    send: (event: Parameters<typeof serializeSse>[0], data: unknown) => void,
    ac: AbortController,
    input: {
      question: string;
      mode: SearchMode;
      conditions?: SearchStreamBody['conditions'];
      /** 18 批 3：本次检索附带的本地资料 id（加载后前置并入来源） */
      uploadIds?: string[];
    },
  ): Promise<'ok' | 'error' | 'aborted'> {
    const user = req.user!;
    const { question, mode } = input;

    let stage: SseStage['stage'] = 'intent';
    /** 18 批 4：本次检索对应的任务 id（会话建立后赋值，供失败/中止时置状态） */
    let pipelineTaskId: string | null = null;

    try {
      // 意图阶段：分类 → 条件回填（手动条件优先）+ 查询重写（口语化问题改写为规范检索问题，提升各检索路召回）
      send('stage', { stage, msg: '理解意图中' } satisfies SseStage);
      const ai = await this.intent.classify(question, ac.signal);
      const conditions = IntentService.mergeConditions(input.conditions ?? {}, ai);
      // 检索路用重写问题（无重写回退原问题）；生成阶段仍用用户原始问题（报告要回答用户问的）
      const searchQuestion = ai.rewrittenQuestion ?? question;

      // 先落会话（拿到 sessionId，供 done/历史使用），条件快照一并保存
      const session = await this.store.createSession(user.userId, question, mode, conditions);
      // 18 批 4：建立检索任务（任务列表可见；失败/中止后可重试）
      pipelineTaskId = await this.task.startRetrieval(session.id);
      send('cond_fill', { conditions } satisfies SseCondFill);

      // 检索 + 融合（按模式路由检索路）；检索优化 B：先查短缓存（租户/模式/问题/条件隔离），
      // 命中跳过外部检索（省 AnySearch/embedding 调用），未命中真实检索后回写（fire-and-forget）
      stage = 'searching';
      send('stage', { stage, msg: '检索中' } satisfies SseStage);
      const connInput: ConnectorInput = { question: searchQuestion, conditions };
      const tenantId = getTenantContext()?.tenantId ?? user.userId;
      let result = await this.cache.get(tenantId, mode, searchQuestion, conditions);
      /** 混合模式的知识库优先路由结果（供 SSE 提示，缓存命中时为 null） */
      let routeInfo: SseSearchRoute | null = null;
      if (result) {
        this.logger.debug(`检索缓存命中: mode=${mode} q=${searchQuestion.slice(0, 20)}`);
      } else {
        let fresh: FusionResult;
        if (mode === 'hybrid') {
          // 18 智搜增强·知识库优先匹配：先跑本地路，命中足够则短路（完全不出外网）；
          // 不足才串行补跑联网+垂直兜底。阈值可由 KB_FIRST_MIN_HITS / KB_FIRST_MIN_SCORE 覆盖
          const localFirst = await this.search.searchLocalFirst(connInput, ac.signal, undefined, {
            minHits: this.config.get<number>('KB_FIRST_MIN_HITS') ?? DEFAULT_LOCAL_FIRST.minHits,
            minScore: this.config.get<number>('KB_FIRST_MIN_SCORE') ?? DEFAULT_LOCAL_FIRST.minScore,
          });
          fresh = localFirst;
          routeInfo = {
            shortCircuited: localFirst.shortCircuited,
            localHits: localFirst.localHits,
            localTopScore: Number(localFirst.localTopScore.toFixed(4)),
            routes: localFirst.routes,
          };
          this.logger.log(
            `知识库优先：命中 ${localFirst.localHits} 条 / 最高相似度 ${localFirst.localTopScore.toFixed(4)} → ` +
              (localFirst.shortCircuited ? '命中足够，短路（不联网）' : '命中不足，已补跑外网'),
          );
        } else {
          fresh = await this.search.search(connInput, ac.signal, undefined, ROUTES_BY_MODE[mode]);
        }
        // 检索优化 C：对 Top10 做 listwise 精排（flash 关思考后实测 ~1.8s，10 条内 listwise 质量稳定；
        // 全量候选参与，精排后 cited/referenced 重切分更准），其余候选保持 RRF 原序。
        // 未启用/超时/解析失败回退 RRF 原序，精排后的顺序随缓存一并保存
        const topHits = [...fresh.cited, ...fresh.referenced];
        const rerankInput = topHits.slice(0, 10);
        const reranked = await this.rerank.rerank(searchQuestion, rerankInput, ac.signal);
        if (reranked) {
          const citeCount = fresh.cited.length;
          const reordered = [...reranked, ...topHits.slice(rerankInput.length)];
          fresh = { ...fresh, cited: reordered.slice(0, citeCount), referenced: reordered.slice(citeCount) };
        }
        result = fresh;
        void this.cache.set(tenantId, mode, searchQuestion, conditions, result);
      }

      // 告知前端本次实际走了哪些检索路（混合模式短路时仅 local），让用户知道结果来自知识库而非外网
      if (routeInfo) send('search_route', routeInfo satisfies SseSearchRoute);

      // 搜索词统计（A-10）：每次检索累计频次，无结果时累计 emptyCount（平台级公共表）
      await this.store.trackSearchTerm(question, result.cited.length + result.referenced.length === 0);

      // 18 批 3：用户补充上传的本地资料 → 作为来源**前置并入**（不参与 RRF 相关度排序，
      // 语义是「用户指定要用」）；放在搜索词统计之后，避免影响检索维度统计口径。过期/越权 id 静默忽略。
      const uploadHits = await this.upload.loadHits(input.uploadIds ?? []);
      if (uploadHits.length) {
        result = { ...result, cited: [...uploadHits, ...result.cited] };
        this.logger.log(`本地资料并入来源 ${uploadHits.length} 条（置顶）session=${session.id}`);
      }

      stage = 'fusing';
      send('stage', { stage, msg: '融合中' } satisfies SseStage);

      // 按 idx 连续编号推送来源卡，并收集（引用级进上下文，参考级仅展示）
      const sources: Array<{ hit: SearchHit; idx: number; isCited: boolean }> = [];
      let idx = 1;
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

      // 17 两段式第一段收尾：精排全量来源落检索快照（含 contentMd，供第二段生成），
      // 推送 sources_ready 后本 SSE 正常结束——不再自动生成，等待用户勾选后调 /stream/generate
      await this.store.saveRetrieval(
        session.id,
        searchQuestion,
        mode,
        sources.map((s) => ({
          idx: s.idx,
          title: s.hit.title,
          url: s.hit.url ?? null,
          snippet: s.hit.snippet,
          contentMd: s.hit.contentMd ?? '',
          sourceType: s.hit.sourceType,
          isCited: s.isCited,
        })),
      );
      send('sources_ready', {
        sessionId: session.id,
        expiresInSeconds: RETRIEVAL_TTL_SECONDS,
      } satisfies SseSourcesReady);
      // 18 批 4：检索完成、等待用户选数据（不占 SSE 资源）
      if (pipelineTaskId) await this.task.markPendingSelect(pipelineTaskId);
      return 'ok';
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown error';
      send('error', {
        message: msg,
        stage,
      } satisfies SseError);
      // 18 批 4：检索任务转失败/中止态（检索失败时试额已回滚，重试不重复扣费）
      if (pipelineTaskId) await this.markTaskFailed(pipelineTaskId, ac.signal.aborted, msg);
      // 用户主动中止不算失败（不回滚试额），仅真实管道异常回滚
      return ac.signal.aborted ? 'aborted' : 'error';
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
    const { items, total } = await this.store.listSessions(req.user!.userId, p, size);
    return { items, total, page: p };
  }

  @Get('reports/:id')
  @HttpCode(200)
  reportDetail(@Req() _req: AuthenticatedRequest, @Param('id') id: string): Promise<unknown> {
    return this.store.reportDetail(id);
  }

  /** 清空当前用户全部智搜历史（报告/来源级联删除，不可恢复） */
  @Delete('histories')
  @HttpCode(200)
  clearHistories(@Req() req: AuthenticatedRequest): Promise<{ deleted: number }> {
    return this.store.clearSessions(req.user!.userId);
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
      ? [...new Set(body.idxs.map(Number).filter((n) => Number.isInteger(n) && n >= 1))]
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