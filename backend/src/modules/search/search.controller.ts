import { Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type {
  ConnectorInput,
  SearchConditions,
} from './connectors/connector.interface';
import { SearchService } from './search.service';
import { IntentService } from './intent/intent.service';
import {
  serializeSse,
  type SseCondFill,
  type SseDone,
  type SseError,
  type SseSource,
  type SseStage,
} from './sse/sse.events';

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
 * 智搜控制器（M2.1 模块骨架）。
 * - GET /api/v1/search/stream：SSE 长连接，跑通 垂直路(WDI)+本地桩 → RRF 融合 → 推送来源/完成事件。
 *   意图分类(M2.2)与 LLM 流式生成(M2.3)阶段将在后续里程碑接入；本批次已验证「垂直路真实取数」。
 * - 历史/报告/存库路由为 M2.3/M3 持久化占位（当前尚未落库）。
 */
@Controller('search')
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly intent: IntentService,
  ) {}

  @Get('stream')
  async stream(
    @Res() res: Response,
    @Query('question') question = '',
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

    try {
      // 意图阶段：分类 → 条件回填（手动条件优先）
      send('stage', { stage: 'intent', msg: '理解意图中' } satisfies SseStage);
      const manual: SearchConditions = parseConditions(conditionsJson);
      const ai = await this.intent.classify(question, ac.signal);
      const conditions = IntentService.mergeConditions(manual, ai);
      send('cond_fill', { conditions } satisfies SseCondFill);

      // 检索 + 融合
      send('stage', { stage: 'searching', msg: '检索中' } satisfies SseStage);
      const input: ConnectorInput = { question, conditions };
      const result = await this.search.search(input, ac.signal);
      send('stage', { stage: 'fusing', msg: '融合中' } satisfies SseStage);

      let idx = 0;
      for (const hit of result.cited) {
        send('source', {
          idx: idx++,
          title: hit.title,
          url: hit.url,
          snippet: hit.snippet,
          sourceType: hit.sourceType,
          isCited: true,
        } satisfies SseSource);
      }
      for (const hit of result.referenced) {
        send('source', {
          idx: idx++,
          title: hit.title,
          url: hit.url,
          snippet: hit.snippet,
          sourceType: hit.sourceType,
          isCited: false,
        } satisfies SseSource);
      }

      send('stage', { stage: 'done' } satisfies SseStage);
      send('done', { sessionId: '', reportId: '' } satisfies SseDone);
    } catch (e) {
      send('error', {
        message: e instanceof Error ? e.message : 'unknown error',
        stage: 'searching',
      } satisfies SseError);
    } finally {
      res.end();
    }
  }

  @Get('histories')
  @HttpCode(200)
  histories(): { items: unknown[]; note: string } {
    // M2.3 接入会话/历史持久化后实现（租户隔离查询 search_sessions）
    return { items: [], note: 'M2.3 接入历史持久化' };
  }

  @Get('reports/:id')
  reportDetail(): { note: string } {
    // M2.3 接入报告/来源持久化后实现
    return { note: 'M2.3 接入报告详情' };
  }

  @Post('reports/:id/save-kb')
  @HttpCode(501)
  saveToKb(): { note: string } {
    // M3 知识库接入后实现（智搜勾选来源存库）
    return { note: 'M3 接入知识库存入链路' };
  }
}
