/**
 * 检索连接器统一接口与类型（三路：垂直/联网/本地）。
 * 各路 connector 实现本接口，产出统一的 SearchHit，供 fusion 融合。
 */

/** 检索模式（会话级路由偏好） */
export type SearchMode = 'hybrid' | 'web' | 'local';

/** 来源类型 */
export type SourceType = 'web' | 'vertical' | 'local';

/** 智搜抽取条件（意图分类产出或用户手动回填，手动优先） */
export interface SearchConditions {
  /** 国家/地区（中文名或 ISO3） */
  countries?: string[];
  /**  * 指标（中文名或 WDI 代码） */
  indicators?: string[];
  /** 起始年份（未识别出为 null） */
  yearFrom?: number | null;
  /** 结束年份（未识别出为 null） */
  yearTo?: number | null;
  /** 路由提示（倾向走哪一路） */
  routeHints?: SourceType[];
}

/** 单条检索命中（统一各路 connector 输出） */
export interface SearchHit {
  /** 标题 */
  title: string;
  /** 链接（垂直路可为空） */
  url?: string;
  /** 摘要/片段 */
  snippet: string;
  /** 已转 Markdown 的正文（垂直路/抓取成功后有） */
  contentMd?: string;
  /** 来源类型 */
  sourceType: SourceType;
  /** 扩展元数据（来源专属，如 WDI 指标/年份） */
  meta?: Record<string, unknown>;
  /** 该路原始得分（用于融合权重，可选） */
  rawScore?: number;
}

/** connector 输入 */
export interface ConnectorInput {
  /** 原始问题 */
  question: string;
  /** 抽取/回填条件 */
  conditions: SearchConditions;
}

/** 统一检索连接器接口 */
export interface SearchConnector {
  /** 该连接器负责的来源类型 */
  readonly sourceType: SourceType;
  /** 检索：返回命中列表（可空），单次失败不应抛错阻断整体 */
  search(input: ConnectorInput, signal: AbortSignal): Promise<SearchHit[]>;
}
