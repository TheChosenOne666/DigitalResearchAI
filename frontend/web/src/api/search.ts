import { request } from '@/api/http';

/** 检索模式（对齐后端 SearchMode：hybrid/web/local） */
export type SearchMode = 'hybrid' | 'web' | 'local';

/** 来源类型 */
export type SourceType = 'web' | 'vertical' | 'local';

/** 智搜条件（与后端 SearchConditions 对齐） */
export interface SearchConditions {
  countries?: string[];
  indicators?: string[];
  yearFrom?: number | null;
  yearTo?: number | null;
  routeHints?: SourceType[];
}

/** SSE 阶段枚举 */
export type SearchStage = 'intent' | 'searching' | 'fusing' | 'generating' | 'done';

/** SSE 事件名 */
export type SearchEventName =
  | 'stage'
  | 'cond_fill'
  | 'source'
  | 'report_chunk'
  | 'done'
  | 'error';

/** 阶段切换事件 */
export interface SseStage {
  stage: SearchStage;
  msg?: string;
}

/** 条件回填事件 */
export interface SseCondFill {
  conditions: SearchConditions;
}

/** 来源卡事件 */
export interface SseSource {
  idx: number;
  title: string;
  url?: string;
  snippet: string;
  sourceType: SourceType;
  isCited: boolean;
}

/** 流式正文片段 */
export interface SseReportChunk {
  text: string;
  citations: number[];
}

/** 完成事件 */
export interface SseDone {
  sessionId: string;
  reportId: string;
}

/** 错误事件 */
export interface SseError {
  message: string;
  stage?: SearchStage;
}

/** 智搜 SSE 各事件回调 */
export interface SearchStreamHandlers {
  onStage?(s: SseStage): void;
  onCondFill?(c: SseCondFill): void;
  onSource?(s: SseSource): void;
  onReportChunk?(c: SseReportChunk): void;
  onDone?(d: SseDone): void;
  onError?(e: SseError): void;
}

/** 历史会话项 */
export interface SessionListItem {
  id: string;
  question: string;
  mode: string;
  conditions: SearchConditions | null;
  createdAt: string;
  reportId?: string;
  reportCreatedAt?: string;
}

/** 报告详情（含来源卡） */
export interface ReportDetail {
  id: string;
  contentMd: string;
  tokenUsage: number;
  createdAt: string;
  sources: Array<{
    idx: number;
    title: string;
    url: string | null;
    snippet: string;
    sourceType: SourceType;
    isCited: boolean;
  }>;
}

/**
 * 智搜 SSE 客户端：通过 fetch 读取流（可携带 Authorization 头 + Abort 控制）。
 * 解析标准 SSE 帧（event:/data:），命中回调；返回一个取消函数。
 */
export function searchStream(
  params: { question: string; mode: SearchMode; conditions?: SearchConditions },
  handlers: SearchStreamHandlers,
  signal?: AbortSignal,
): Promise<{ sessionId: string; reportId: string } | void> {
  const query = new URLSearchParams();
  query.set('question', params.question);
  query.set('mode', params.mode);
  if (params.conditions) {
    query.set('conditions', JSON.stringify(params.conditions));
  }
  const url = `/api/v1/search/stream?${query.toString()}`;

  const sessionId = localStorage.getItem('web.sessionId');
  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  if (sessionId) headers.Authorization = `Bearer ${sessionId}`;

  return fetch(url, { headers, signal }).then(async (res) => {
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      handlers.onError?.({ message: text || `请求失败(${res.status})` });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let donePayload: SseDone | null = null;

    const dispatch = (event: SearchEventName, data: unknown): void => {
      const record = data as Record<string, unknown>;
      switch (event) {
        case 'stage':
          handlers.onStage?.(record as unknown as SseStage);
          break;
        case 'cond_fill':
          handlers.onCondFill?.(record as unknown as SseCondFill);
          break;
        case 'source':
          handlers.onSource?.(record as unknown as SseSource);
          break;
        case 'report_chunk':
          handlers.onReportChunk?.(record as unknown as SseReportChunk);
          break;
        case 'done':
          donePayload = record as unknown as SseDone;
          handlers.onDone?.(donePayload);
          break;
        case 'error':
          handlers.onError?.(record as unknown as SseError);
          break;
      }
    };

    // 将一个 SSE 帧文本解析成 (event, data) 对返回
    const parseFrames = (block: string): void => {
      let event: SearchEventName = 'stage';
      const dataLines: string[] = [];
      for (const rawLine of block.split('\n')) {
        const line = rawLine.trimEnd();
        if (!line) continue;
        if (line.startsWith(':')) continue; // 注释/心跳
        if (line.startsWith('event:')) {
          event = line.slice(6).trim() as SearchEventName;
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
      if (dataLines.length === 0) return;
      const json = dataLines.join('\n');
      try {
        dispatch(event, JSON.parse(json));
      } catch {
        /* 单帧解析失败忽略 */
      }
    };

    // 流式读取并切分 SSE 帧（以空行分隔）
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sepIdx: number;
      while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        parseFrames(frame);
      }
    }
    // 结尾残留帧（无结尾空行时）
    if (buffer.trim()) parseFrames(buffer);
    return donePayload ?? undefined;
  });
}

/** 历史会话列表（分页） */
export async function fetchHistories(page = 1, pageSize = 20): Promise<{
  items: SessionListItem[];
  total: number;
  page: number;
}> {
  return request(`/api/v1/search/histories?page=${page}&pageSize=${pageSize}`);
}

/** 报告详情（后端按 sessionId 查询） */
export async function fetchReportDetail(sessionId: string): Promise<ReportDetail> {
  return request(`/api/v1/search/reports/${encodeURIComponent(sessionId)}`);
}