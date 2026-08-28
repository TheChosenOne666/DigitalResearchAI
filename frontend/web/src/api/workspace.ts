import { request } from '@/api/http';

/** 单条时序序列（某国家在某指标下的逐年值） */
export interface DatasetSeries {
  country: string;
  iso3: string;
  values: Record<string, number>;
  /** 数据来源标注（上传补充行标记本地文件名，WDI 行缺省回退全局 source） */
  source?: string;
}

/** 单个指标的时序数据集 */
export interface DatasetIndicator {
  indicator: string;
  indicatorCode: string;
  series: DatasetSeries[];
}

/** 工作台数据集查询结果 */
export interface DatasetResult {
  indicators: DatasetIndicator[];
  years: string[];
  source: string;
}

/**
 * 数据工作台时序数据查询（M4.1）：按国家/指标/年份取 WDI 结构化时序数据。
 */
export async function fetchDataset(params: {
  countries: string[];
  indicators: string[];
  yearFrom: number;
  yearTo: number;
}): Promise<DatasetResult> {
  const query = new URLSearchParams();
  query.set('countries', params.countries.join(','));
  query.set('indicators', params.indicators.join(','));
  query.set('yearFrom', String(params.yearFrom));
  query.set('yearTo', String(params.yearTo));
  return request(`/api/v1/workspace/dataset?${query.toString()}`);
}

/** 上传文件解析结果 */
export interface UploadedDataset {
  rows: Array<{ name: string; values: Record<string, number> }>;
  years: string[];
}

/**
 * 上传 Excel/CSV 补充数据（M4.2）：解析宽表（首列实体名、表头年份）为时序行。
 */
export function uploadDataset(file: File): Promise<UploadedDataset> {
  const fd = new FormData();
  fd.append('file', file);
  return request('/api/v1/workspace/upload', { method: 'POST', body: fd });
}

// ===== M4.3 分析结果 =====

/** 来源项 */
export interface AnalyzeSource {
  name: string;
  url?: string;
  desc?: string;
  type: string;
}

/** 图表配置快照 */
export interface AnalyzeChartConfig {
  type?: string;
  from?: number;
  to?: number;
  label?: boolean;
  grid?: boolean;
}

/** 分析入参（工作台把合并后的时序数据 + 来源 + 图表配置一并传入） */
export interface AnalyzeParams {
  indicator: { name: string; unit: string; note?: string; code?: string };
  countries: string[];
  years: string[];
  series: Array<{ country: string; values: Record<string, number> }>;
  sources: AnalyzeSource[];
  chartConfig?: AnalyzeChartConfig;
  question?: string;
}

/** 统计卡片 */
export interface AnalyzeStats {
  sampleCount: number;
  yearRange: string;
  yearCount: number;
  endAvg: number | null;
  changePct: number | null;
  completeness: number;
  nonNull: number;
  totalCells: number;
}

/** 分析报告详情（含 paramsSnapshot 内的统计与数据表） */
export interface AnalyzeReportDetail {
  id: string;
  title: string;
  contentMd: string;
  paramsSnapshot: {
    indicator?: { name: string; unit: string; note?: string; code?: string };
    countries?: string[];
    years?: string[];
    series?: Array<{ country: string; values: Record<string, number> }>;
    chartConfig?: AnalyzeChartConfig | null;
    question?: string | null;
    stats?: AnalyzeStats;
    table?: { head: string[]; rows: Array<Array<string | number>> };
  } | null;
  sources: AnalyzeSource[];
  tokenUsage: number;
  status: string;
  version: number;
  createdAt: string;
}

/** 分析 SSE 事件回调 */
export interface AnalyzeStreamHandlers {
  onStage?(s: { stage: string; msg?: string }): void;
  onReportChunk?(c: { text: string; citations: number[] }): void;
  onDone?(d: { reportId: string }): void;
  onError?(e: { message: string }): void;
}

type AnalyzeEventName = 'stage' | 'report_chunk' | 'done' | 'error';

/**
 * 生成分析结果（M4.3）：POST 读流解析 SSE（stage → report_chunk → done{reportId}）。
 * 返回 done 事件中的 reportId（供跳转分析结果页）。
 */
export function analyzeStream(
  params: AnalyzeParams,
  handlers: AnalyzeStreamHandlers,
  signal?: AbortSignal,
): Promise<{ reportId: string } | void> {
  const sessionId = localStorage.getItem('web.sessionId');
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
  };
  if (sessionId) headers.Authorization = `Bearer ${sessionId}`;

  return fetch('/api/v1/workspace/analyze', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
    signal,
  }).then(async (res) => {
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      handlers.onError?.({ message: text || `请求失败(${res.status})` });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let donePayload: { reportId: string } | null = null;

    const parseFrames = (block: string): void => {
      let event: AnalyzeEventName = 'stage';
      const dataLines: string[] = [];
      for (const rawLine of block.split('\n')) {
        const line = rawLine.trimEnd();
        if (!line) continue;
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) {
          event = line.slice(6).trim() as AnalyzeEventName;
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
      if (!dataLines.length) return;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(dataLines.join('\n'));
      } catch {
        return;
      }
      switch (event) {
        case 'stage':
          handlers.onStage?.(data as { stage: string; msg?: string });
          break;
        case 'report_chunk':
          handlers.onReportChunk?.(data as { text: string; citations: number[] });
          break;
        case 'done':
          donePayload = data as { reportId: string };
          handlers.onDone?.(donePayload);
          break;
        case 'error':
          handlers.onError?.(data as { message: string });
          break;
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

/** 分析报告详情 */
export async function fetchAnalyzeReport(id: string): Promise<AnalyzeReportDetail> {
  return request(`/api/v1/workspace/reports/${encodeURIComponent(id)}`);
}

/** 整份分析结果存入知识库（M4.3）：提交后 PENDING 待审核 */
export async function saveAnalyzeToKb(
  id: string,
  body: { libraryId: string; groupId?: string | null; visibility?: string; tags?: string[] },
): Promise<{ created: number; documents: Array<{ id: string; name: string }> }> {
  return request(`/api/v1/workspace/reports/${encodeURIComponent(id)}/save-kb`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
