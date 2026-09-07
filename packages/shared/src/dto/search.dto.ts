import { z } from 'zod';

/**
 * 意图分类结构化输出 Schema（LLM 输出校验单一事实源，M2.2）。
 * 字段与检索连接器输入 SearchConditions 对齐，仅多出 intent 自然语言概述。
 */
export const SearchIntentSchema = z.object({
  /** 用户问题的自然语言意图概述 */
  intent: z.string().optional(),
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
});

/** 智搜检索体类型 */
export type SearchStreamBody = z.infer<typeof SearchStreamSchema>;
