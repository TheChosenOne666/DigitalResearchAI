import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/session-auth.guard';
import type {
  ConnectorInput,
  SearchConditions,
  SearchHit,
  SearchMode,
} from './connectors/connector.interface';
import { SearchService } from './search.service';
import { IntentService } from './intent/intent.service';
import { GenerateService } from './generate/generate.service';
import { SearchStoreService } from './persistence/search.store.service';
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

/**
 * 智搜控制器（M2 核心：GET /search/stream 一次请求 → SSE 长连接 → 五阶段事件流式推送）。
 * 阶段：intent(意图分类) → searching(检索) → fusing(融合) → generating(LLM 流式生成) → done；
 * 会话/报告/来源/用量落库(M2.3)，客户端断开 → AbortController 全链路取消。
 */
@Controller('search')
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly intent: IntentService,
    private readonly generate: GenerateService,
    private readonly store: SearchStoreService,
  ) {}

  @Get('stream')
  async stream(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Query('question') question = '',
    @Query('mode') mode: SearchMode = 'hybrid',
    @Query('conditions') conditionsJson?: string,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const ac = new AbortController();
    res.on('close', () => ac.abort());

    const send = (event: Parameters<typeof serializeSse>[0], data: unknown) =>
      res.write(serializeSse(event, data));

    const user = req.user!;
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

      // 检索 + 融合
      stage = 'searching';
      send('stage', { stage, msg: '检索中' } satisfies SseStage);
      const input: ConnectorInput = { question, conditions };
      const result = await this.search.search(input, ac.signal);

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
    } finally {
      res.end();
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

  @Post('reports/:id/save-kb')
  @HttpCode(501)
  saveToKb(): { note: string } {
    // M3 知识库接入后实现（智搜勾选来源存库）
    return { note: 'M3 接入知识库存入链路' };
  }
}