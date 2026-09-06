import type { SseSource } from '@/api/search';

/** 智搜模块共享类型与工具（SearchView 及其子组件共用） */

/** 检索条件（AI 回填 has-val 状态，可手动微调） */
export interface SearchCondState {
  countries: string[];
  indicators: string[];
  yearFrom: number | null;
  yearTo: number | null;
}

/** 来源卡类型徽标文案 */
export function sourceTypeLabel(t: SseSource['sourceType']): string {
  return t === 'vertical' ? '垂直数据' : t === 'web' ? '联网' : '知识库';
}
