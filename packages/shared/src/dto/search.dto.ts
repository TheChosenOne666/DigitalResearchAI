import { z } from 'zod';

/**
 * 意图分类结构化输出 Schema（LLM 输出校验单一事实源，M2.2）。
 * 字段与检索连接器输入 SearchConditions 对齐，仅多出 intent 自然语言概述。
 */
export const SearchIntentSchema = z.object({
  /** 用户问题的自然语言意图概述 */
  intent: z.string().optional(),
  /** 查询重写：将口语化/模糊问题改写为规范检索问题，供检索路使用（生成仍用原始问题）；失败/缺省降级用原问题 */
  rewrittenQuestion: z.string().optional(),
  /** 国家/地区（中文名或 ISO3），无则空数组 */
  countries: z.array(z.string()).default([]),
  /** 指标（中文名或 WDI 代码），无则空数组 */
  indicators: z.array(z.string()).default([]),
  /** 起始年份，未知为 null */
  yearFrom: z.number().int().nullable(),
  /** 结束年份，未知为 null */
  yearTo: z.number().int().nullable(),
  /** 倾向走的检索路（web/vertical/local），无则空数组 */
  routeHints: z.array(z.enum(['web', 'vertical', 'local'])).default([]),
});

/** 意图分类结果类型 */
export type SearchIntent = z.infer<typeof SearchIntentSchema>;

/** 检索条件 Schema（POST /search/stream body 内嵌，与 GET 时代 query JSON 结构对齐） */
export const SearchConditionsSchema = z.object({
  /** 国家/地区 */
  countries: z.array(z.string()).optional(),
  /** 统计指标 */
  indicators: z.array(z.string()).optional(),
  /** 起始年份 */
  yearFrom: z.number().int().nullable().optional(),
  /** 结束年份 */
  yearTo: z.number().int().nullable().optional(),
  /** 倾向走的检索路 */
  routeHints: z.array(z.enum(['web', 'vertical', 'local'])).optional(),
});

/**
 * 智搜检索体 Schema（POST /search/stream）：
 * 问题走 JSON body，避免 URL 传参的长度限制与网关日志明文泄漏。
 */
export const SearchStreamSchema = z.object({
  /** 研究问题（会话表 question 列 varchar(512)） */
  question: z.string().min(1).max(512),
  /** 检索模式，缺省混合 */
  mode: z.enum(['hybrid', 'web', 'local']).default('hybrid'),
  /** 手动筛选条件（优先级高于 AI 回填），缺省视为无 */
  conditions: SearchConditionsSchema.optional(),
  /** 本次检索附带的本地资料（18 批 3：智搜「+」上传所得 id，最多 5 个） */
  uploadIds: z.array(z.string().min(1)).max(5).optional(),
});

/** 智搜检索体类型 */
export type SearchStreamBody = z.infer<typeof SearchStreamSchema>;

/**
 * 第二段生成入参 Schema（POST /search/stream/generate，17 交互重构）：
 * 检索快照落库后，用户勾选来源编号触发报告生成。
 */
export const SearchGenerateSchema = z.object({
  /** 检索快照所属会话 id（第一段 sources_ready 事件返回） */
  sessionId: z.string().min(1),
  /** 勾选的来源编号（1 起、对应快照 sources.idx，非空、去重） */
  selectedIdxs: z.array(z.number().int().min(1)).min(1),
});

/** 第二段生成入参类型 */
export type SearchGenerateBody = z.infer<typeof SearchGenerateSchema>;

/** 检索快照来源项（快照 sources JSON 数组元素） */
export interface RetrievalSourceItem {
  /** 来源序号（快照内 1 起连续编号） */
  idx: number;
  title: string;
  url: string | null;
  snippet: string;
  contentMd: string;
  /** 来源类型（upload = 用户补充上传的本地资料，18 批 3） */
  sourceType: 'web' | 'vertical' | 'local' | 'upload';
  /** 融合阶段的引用级标记（true 为建议默认勾选） */
  isCited: boolean;
}

/** 检索快照响应（GET /search/retrievals/:sessionId，恢复选择态用） */
export interface RetrievalSnapshotDto {
  sessionId: string;
  /** 重写后的检索问题 */
  question: string;
  mode: string;
  sources: RetrievalSourceItem[];
  createdAt: string;
  /** 恢复窗口剩余秒数（<=0 表示已过期，应提示重新检索） */
  expiresInSeconds: number;
}

/**
 * 检索快照有效期（秒）。
 * 前后端共用单一事实源：后端据此判定生成/续跑是否过期，
 * 前端据此把「已过期」提示里的等待时长说清楚（避免各写一份硬编码「30 分钟」）。
 */
export const RETRIEVAL_TTL_SECONDS = 30 * 60;
