import type { KbDocStatus } from '@/api/kb';

/** 知识库模块共享元数据与工具（KnowledgeView 及其子面板共用） */

/** 库卡片封面色可选值 */
export const KB_COLORS = ['#2563EB', '#059669', '#D97706', '#DC2626', '#7C3AED', '#16675F'];

/** 学习状态徽标映射（对齐原型 9.12：用户端仅展示 学习完成/学习失败/学习中断 三态；待审核/学习中统一按「学习中断」呈现） */
export const STATUS_META: Record<KbDocStatus, { label: string; type: 'success' | 'danger' | 'warning' }> = {
  PENDING: { label: '学习中断', type: 'warning' },
  LEARNING: { label: '学习中断', type: 'warning' },
  READY: { label: '学习完成', type: 'success' },
  FAILED: { label: '学习失败', type: 'danger' },
  INTERRUPTED: { label: '学习中断', type: 'warning' },
};

/** 状态筛选选项（对齐原型：仅三学习态，不含审核态） */
export const STATUS_FILTER = [
  { label: '学习完成', value: 'READY' },
  { label: '学习失败', value: 'FAILED' },
  { label: '学习中断', value: 'INTERRUPTED' },
];

/** 相似度分级徽标 */
export const GRADE_META: Record<string, { label: string; type: 'success' | 'warning' | 'danger' }> = {
  HIGH: { label: '相似度高', type: 'success' },
  MID: { label: '相似度中', type: 'warning' },
  LOW: { label: '相似度低', type: 'danger' },
};

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString();
}
