import type { SearchConditions, SourceType } from '../connectors/connector.interface';

/** 阶段枚举（五阶段：意图→检索→融合→生成→完成） */
export type SearchStage = 'intent' | 'searching' | 'fusing' | 'generating' | 'done';

/** SSE 事件名 */
export type SseEventName =
  | 'stage'
  | 'cond_fill'
  | 'search_route'
  | 'source'
  | 'sources_ready'
  | 'section_done'
  | 'report_chunk'
  | 'done'
  | 'error';

/** 阶段切换事件（先行推送，首字节 ≤3s） */
export interface SseStage {
  stage: SearchStage;
  msg?: string;
}

/**
 * 检索路由结果事件（18 智搜增强·知识库优先匹配）：
 * 混合模式下先跑知识库，命中足够则短路不联网，此事件告知前端本次实际走了哪些检索路，
 * 让用户知道结果来自知识库而非外网。
 */
export interface SseSearchRoute {
  /** 是否触发知识库优先短路（true = 未发起联网检索） */
  shortCircuited: boolean;
  /** 短路判定依据：知识库命中条数 */
  localHits: number;
  /** 短路判定依据：知识库命中最高相似度（0-1） */
  localTopScore: number;
  /** 本次实际执行的检索路（短路时仅 local） */
  routes: SourceType[];
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

/** 检索就绪事件（17 两段式第一段收尾）：全量来源已推送并落快照，SSE 即将正常结束，前端进入选择态 */
export interface SseSourcesReady {
  sessionId: string;
  /** 检索快照恢复窗口剩余秒数（生成/恢复接口按此判定过期） */
  expiresInSeconds: number;
}

/** 流式正文片段（citations 为本片段出现的 {c:N} 编号） */
export interface SseReportChunk {
  text: string;
  citations: number[];
}

/**
 * 章节完成事件（18 批 4 分段生成）：每完成一章推送一次，
 * 前端可显示「已完成 x/3 章」，也是断点位置的对外可见信号。
 */
export interface SseSectionDone {
  /** 刚完成的章节序号（0 起） */
  idx: number;
  /** 章节标题 */
  heading: string;
  /** 已完成章节数 */
  doneCount: number;
  /** 章节总数 */
  total: number;
}

/** 完成事件 */
export interface SseDone {
  sessionId: string;
  reportId: string;
}

/** 错误事件（不中断已推内容，最后发） */
export interface SseError {
  message: string;
  /**
   * 结构化错误明细（多条）：生成中断时每章一条，前端逐条换行展示，
   * 避免多条原因挤在一行难以阅读。为空时前端回落到 `message`。
   */
  messages?: string[];
  /**
   * 可续跑的任务 id：生成类失败/中断时携带，前端据此在报告区直接显示
   * 「继续生成」按钮（无需用户自行打开任务中心查找）。
   */
  taskId?: string;
  stage?: SearchStage;
}

/** 序列化为 SSE 帧（event:/data: 标准格式，data 为 JSON） */
export function serializeSse(event: SseEventName, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
