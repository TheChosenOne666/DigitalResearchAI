import type { SearchConditions, SourceType } from '../connectors/connector.interface';

/** 阶段枚举（五阶段：意图→检索→融合→生成→完成） */
export type SearchStage = 'intent' | 'searching' | 'fusing' | 'generating' | 'done';

/** SSE 事件名 */
export type SseEventName = 'stage' | 'cond_fill' | 'source' | 'report_chunk' | 'done' | 'error';

/** 阶段切换事件（先行推送，首字节 ≤3s） */
export interface SseStage {
  stage: SearchStage;
  msg?: string;
}

/** 条件回填事件（意图分类完成 → 前端转 has-val 深色态，可手动微调） */
export interface SseCondFill {
  conditions: SearchConditions;
}

/** 来源卡事件（融合后逐个推送；isCited=true 进上下文） */
export interface SseSource {
  idx: number;
  title: string;
  url?: string;
  snippet: string;
  sourceType: SourceType;
  isCited: boolean;
}

/** 流式正文片段（citations 为本片段出现的 {c:N} 编号） */
export interface SseReportChunk {
  text: string;
  citations: number[];
}

/** 完成事件 */
export interface SseDone {
  sessionId: string;
  reportId: string;
}

/** 错误事件（不中断已推内容，最后发） */
export interface SseError {
  message: string;
  stage?: SearchStage;
}

/** 序列化为 SSE 帧（event:/data: 标准格式，data 为 JSON） */
export function serializeSse(event: SseEventName, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
