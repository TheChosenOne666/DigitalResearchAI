import { request } from '@/api/http';

/** 检索模式（对齐后端 SearchMode：hybrid/web/local） */
export type SearchMode = 'hybrid' | 'web' | 'local';

/** 来源类型 */
export type SourceType = 'web' | 'vertical' | 'local' | 'upload';

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

/** SSE 事件名（sources_ready 为 17 两段式第一段收尾事件） */
export type SearchEventName =
  | 'stage'
  | 'cond_fill'
  | 'search_route'
  | 'source'
  | 'sources_ready'
  | 'section_done'
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

/** 检索路由结果事件（18 智搜增强·知识库优先匹配） */
export interface SseSearchRoute {
  /** 是否触发知识库优先短路（true = 未发起联网检索） */
  shortCircuited: boolean;
  /** 短路判定依据：知识库命中条数 */
  localHits: number;
  /** 短路判定依据：知识库命中最高相似度（0-1） */
  localTopScore: number;
  /** 本次实际执行的检索路 */
  routes: SourceType[];
}

/** 流式正文片段 */
export interface SseReportChunk {
  text: string;
  citations: number[];
}

/** 章节完成事件（18 批 4 分段生成）：report_chunk 之后、下一章开始前推送 */
export interface SseSectionDone {
  /** 刚完成的章节序号（0 起） */
  idx: number;
  heading: string;
  /** 已完成章节数 / 章节总数 */
  doneCount: number;
  total: number;
}

/** 检索就绪事件（17 两段式第一段收尾） */
export interface SseSourcesReady {
  sessionId: string;
  expiresInSeconds: number;
}

/** 完成事件 */
export interface SseDone {
  sessionId: string;
  reportId: string;
}

/** 错误事件 */
export interface SseError {
  message: string;
  /**
   * 结构化错误明细（多条）：生成中断/部分章节失败时逐条给出原因，
   * 前端按条换行展示；为空时前端回落到 `message`。
   */
  messages?: string[];
  /** 可续跑的任务 id（生成类失败/中断时携带），前端据此显示内联「继续生成」按钮 */
  taskId?: string;
  stage?: SearchStage;
}

/** 智搜 SSE 各事件回调 */
export interface SearchStreamHandlers {
  onStage?(s: SseStage): void;
  onCondFill?(c: SseCondFill): void;
  onSearchRoute?(r: SseSearchRoute): void;
  onSource?(s: SseSource): void;
  onSourcesReady?(r: SseSourcesReady): void;
  onSectionDone?(s: SseSectionDone): void;
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
  /** 17 两段式：pending_selection=待选择（点击恢复选择态）/ done=已出报告 */
  status?: 'pending_selection' | 'done';
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
 * 智搜 SSE 客户端：POST JSON body 发起（问题不进 URL，规避长度限制与网关日志泄漏），
 * fetch 读取流（可携带 Authorization 头 + Abort 控制）。解析标准 SSE 帧，命中回调。
 */
export function searchStream(
  params: {
    question: string;
    mode: SearchMode;
    conditions?: SearchConditions;
    /** 18 批 3：本次检索附带的本地资料 id（智搜「+」上传所得，后端会前置并入来源） */
    uploadIds?: string[];
  },
  handlers: SearchStreamHandlers,
  signal?: AbortSignal,
): Promise<{ sessionId: string; reportId: string } | void> {
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
  };
  const sessionId = localStorage.getItem('web.sessionId');
  if (sessionId) headers.Authorization = `Bearer ${sessionId}`;

  return fetch('/api/v1/search/stream', {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      question: params.question,
      mode: params.mode,
      conditions: params.conditions ?? {},
      uploadIds: params.uploadIds ?? [],
    }),
  }).then(async (res) => {
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
        case 'search_route':
          handlers.onSearchRoute?.(record as unknown as SseSearchRoute);
          break;
        case 'sources_ready':
          handlers.onSourcesReady?.(record as unknown as SseSourcesReady);
          break;
        case 'report_chunk':
          handlers.onReportChunk?.(record as unknown as SseReportChunk);
          break;
        case 'section_done':
          handlers.onSectionDone?.(record as unknown as SseSectionDone);
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

/** 清空当前用户全部智搜历史（后端级联删除报告与来源，不可恢复） */
export async function clearHistories(): Promise<{ deleted: number }> {
  return request(`/api/v1/search/histories`, { method: 'DELETE' });
}

/** 报告详情（后端按 sessionId 查询） */
export async function fetchReportDetail(sessionId: string): Promise<ReportDetail> {
  return request(`/api/v1/search/reports/${encodeURIComponent(sessionId)}`);
}

/**
 * 两段式第二段：基于检索快照与勾选来源生成报告（SSE，事件 stage/report_chunk/done/error）。
 * 复用 searchStream 的 SSE 帧解析；仅勾选来源进生成上下文。
 */
export function generateStream(
  params: { sessionId: string; selectedIdxs: number[] },
  handlers: SearchStreamHandlers,
  signal?: AbortSignal,
): Promise<{ sessionId: string; reportId: string } | void> {
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
  };
  const sessionId = localStorage.getItem('web.sessionId');
  if (sessionId) headers.Authorization = `Bearer ${sessionId}`;

  return fetch('/api/v1/search/stream/generate', {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify(params),
  }).then(async (res) => {
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      let message = text;
      try {
        const body = JSON.parse(text) as { message?: string };
        if (body?.message) message = body.message;
      } catch {
        /* 非 JSON 错误体原样展示 */
      }
      handlers.onError?.({ message: message || `请求失败(${res.status})` });
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
        case 'report_chunk':
          handlers.onReportChunk?.(record as unknown as SseReportChunk);
          break;
        case 'section_done':
          handlers.onSectionDone?.(record as unknown as SseSectionDone);
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

    const parseFrames = (block: string): void => {
      let event: SearchEventName = 'stage';
      const dataLines: string[] = [];
      for (const rawLine of block.split('\n')) {
        const line = rawLine.trimEnd();
        if (!line) continue;
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) {
          event = line.slice(6).trim() as SearchEventName;
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
      if (dataLines.length === 0) return;
      try {
        dispatch(event, JSON.parse(dataLines.join('\n')));
      } catch {
        /* 单帧解析失败忽略 */
      }
    };

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
    if (buffer.trim()) parseFrames(buffer);
    return donePayload ?? undefined;
  });
}

/** 检索快照（17 两段式：恢复选择态） */
export interface RetrievalSnapshot {
  sessionId: string;
  question: string;
  mode: string;
  sources: Array<{
    idx: number;
    title: string;
    url: string | null;
    snippet: string;
    contentMd: string;
    sourceType: SourceType;
    isCited: boolean;
  }>;
  createdAt: string;
  /** 恢复窗口剩余秒数（<=0 已过期，应提示重新检索） */
  expiresInSeconds: number;
}

/** 取检索快照（离开/刷新后恢复选择态） */
export async function fetchRetrieval(sessionId: string): Promise<RetrievalSnapshot> {
  return request(`/api/v1/search/retrievals/${encodeURIComponent(sessionId)}`);
}

/** 单个上传文件的处理结果（18 批 3） */
export interface SearchUploadItem {
  name: string;
  size: number;
  status: 'parsed' | 'failed';
  /** 成功时的资料 id，作为 searchStream 的 uploadIds 传入 */
  id?: string;
  /** 失败原因 */
  error?: string;
}

/**
 * 上传本地资料（18 批 3：智搜输入框「+」）：
 * 多文件（字段名 files）→ 后端逐个解析为「本地资料」来源，返回每个文件的结果。
 * 不单独计费；失败文件不落库，仅返回原因供前端提示。
 * @param files 用户选择的文件列表（单次最多 5 个，单文件 ≤ 20MB）
 */
export async function uploadSearchFiles(files: File[]): Promise<SearchUploadItem[]> {
  const form = new FormData();
  for (const f of files) form.append('files', f);
  const sessionId = localStorage.getItem('web.sessionId');
  const res = await fetch('/api/v1/search/uploads', {
    method: 'POST',
    headers: sessionId ? { Authorization: `Bearer ${sessionId}` } : {},
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = text;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {
      /* 非 JSON 错误体，原样展示 */
    }
    // multer 超限返回 413（无 JSON 体），给出可读文案
    if (res.status === 413) message = '文件超过 20MB 上限';
    throw new Error(message || `上传失败(${res.status})`);
  }
  const body = (await res.json()) as { data?: { files?: SearchUploadItem[] } };
  return body.data?.files ?? [];
}

// ===== 18 批 4：任务管控（列表 / 中止 / 删除 / 断点续跑） =====

/** 任务类型 */
export type SearchTaskType = 'retrieval' | 'generate';

/** 任务状态 */
export type SearchTaskStatus =
  | 'RETRIEVING'
  | 'PENDING_SELECT'
  | 'GENERATING'
  | 'DONE'
  | 'RETRIEVAL_FAILED'
  | 'GENERATE_FAILED'
  | 'ABORTED';

/** 智搜任务项 */
export interface SearchTaskItem {
  id: string;
  sessionId: string;
  type: SearchTaskType;
  status: SearchTaskStatus;
  /** 进度 0-100（生成阶段按已完成章节折算） */
  progress: number;
  errorMsg: string | null;
  question: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  /**
   * 剩余可续跑秒数（仅「生成类 + 中断/失败态」有值，其余为 null）：
   * 由检索快照有效期折算；0 表示快照已过期，需重新检索后才能生成。
   */
  resumableSeconds: number | null;
}

/** 拉取任务列表（分页 + 状态分组） */
export async function listSearchTasks(
  params: { status?: 'active' | 'done' | 'failed'; page?: number; pageSize?: number } = {},
): Promise<{ items: SearchTaskItem[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  const query = qs.toString();
  return request(`/api/v1/search/tasks${query ? `?${query}` : ''}`);
}

/** 中止进行中的任务（生成流程在下一章节边界停止，已生成内容保留） */
export async function abortSearchTask(taskId: string): Promise<{ id: string; status: string }> {
  return request(`/api/v1/search/tasks/${encodeURIComponent(taskId)}/abort`, { method: 'POST' });
}

/** 删除任务记录（不影响已生成的报告） */
export async function deleteSearchTask(taskId: string): Promise<void> {
  await request(`/api/v1/search/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
}

/**
 * 继续生成（断点续跑，SSE）：从报告断点继续生成剩余章节，已完成章节不重复生成。
 * 事件与 `generateStream` 一致（stage / report_chunk / done / error）。
 */
export function resumeGenerateStream(
  taskId: string,
  handlers: SearchStreamHandlers,
  signal?: AbortSignal,
): Promise<{ sessionId: string; reportId: string } | void> {
  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  const sessionId = localStorage.getItem('web.sessionId');
  if (sessionId) headers.Authorization = `Bearer ${sessionId}`;

  return fetch(`/api/v1/search/tasks/${encodeURIComponent(taskId)}/resume`, {
    method: 'POST',
    headers,
    signal,
  }).then(async (res) => {
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      let message = text;
      try {
        const body = JSON.parse(text) as { message?: string };
        if (body?.message) message = body.message;
      } catch {
        /* 非 JSON 错误体原样展示 */
      }
      handlers.onError?.({ message: message || `继续生成失败(${res.status})` });
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
        case 'report_chunk':
          handlers.onReportChunk?.(record as unknown as SseReportChunk);
          break;
        case 'section_done':
          handlers.onSectionDone?.(record as unknown as SseSectionDone);
          break;
        case 'done':
          donePayload = record as unknown as SseDone;
          handlers.onDone?.(donePayload);
          break;
        case 'error':
          handlers.onError?.(record as unknown as SseError);
          break;
        default:
          break;
      }
    };

    for (;;) {
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      if (done) {
        buffer += decoder.decode();
        break;
      }
      let sepIdx: number;
      while ((sepIdx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        const evLine = /^event:\s*(.+)$/m.exec(frame);
        const dataLine = /^data:\s*(.+)$/m.exec(frame);
        if (!evLine) continue;
        dispatch(
          evLine[1].trim() as SearchEventName,
          dataLine ? JSON.parse(dataLine[1]) : null,
        );
      }
    }
    if (buffer.trim()) {
      const evLine = /^event:\s*(.+)$/m.exec(buffer);
      const dataLine = /^data:\s*(.+)$/m.exec(buffer);
      if (evLine) {
        dispatch(evLine[1].trim() as SearchEventName, dataLine ? JSON.parse(dataLine[1]) : null);
      }
    }
    return donePayload ?? undefined;
  });
}