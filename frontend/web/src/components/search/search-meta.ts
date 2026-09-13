import type { SseSource } from '@/api/search';

/** 智搜模块共享类型与工具（SearchView 及其子组件共用） */

/** 检索条件（AI 回填 has-val 状态，可手动微调） */
export interface SearchCondState {
  countries: string[];
  indicators: string[];
  yearFrom: number | null;
  yearTo: number | null;
}

/** 国家/地区下拉预设选项（与后端 vertical.connector 的 COUNTRY_ISO3 字典保持一致） */
export const COUNTRY_OPTIONS: string[] = [
  '中国',
  '美国',
  '日本',
  '德国',
  '英国',
  '法国',
  '印度',
  '巴西',
  '俄罗斯',
  '韩国',
  '加拿大',
  '澳大利亚',
  '意大利',
  '西班牙',
  '墨西哥',
  '印度尼西亚',
  '土耳其',
  '荷兰',
  '沙特阿拉伯',
  '瑞士',
  '新加坡',
  '中国香港',
  '中国台湾',
  '越南',
  '泰国',
  '马来西亚',
  '阿根廷',
  '南非',
  '埃及',
  '尼日利亚',
  '波兰',
  '瑞典',
  '比利时',
  '奥地利',
  '挪威',
  '丹麦',
  '芬兰',
  '以色列',
  '阿联酋',
];

/** 统计指标下拉预设选项（与后端 INDICATOR_WDI 字典一致，同码异名仅保留一个） */
export const INDICATOR_OPTIONS: string[] = [
  'GDP',
  '人均GDP',
  'GDP增长率',
  '通货膨胀率',
  '失业率',
  '人口',
  '人均GNI',
  '外商直接投资',
  '商品出口',
  '商品进口',
  '政府债务率',
  '外汇储备',
  '城镇化率',
  '预期寿命',
  '儿童死亡率',
  '识字率',
  '二氧化碳排放',
  '发电量',
  '互联网普及率',
  '研发投入',
  '高等教育入学率',
];

/** 来源卡类型徽标文案（upload = 18 批 3 用户补充上传的本地资料） */
export function sourceTypeLabel(t: SseSource['sourceType']): string {
  if (t === 'vertical') return '垂直数据';
  if (t === 'web') return '联网';
  if (t === 'upload') return '本地资料';
  return '知识库';
}
