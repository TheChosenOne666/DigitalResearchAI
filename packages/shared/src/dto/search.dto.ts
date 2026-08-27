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
