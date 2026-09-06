/**
 * 数据分析工作台共享常量与工具（WorkspaceView 及其子面板共用）
 */

/** 指标元信息（对齐后端 vertical.connector 的 COUNTRY_ISO3 / INDICATOR_WDI 中文名） */
export interface IndicatorMeta {
  id: string;
  name: string;
  unit: string;
  decimals: number;
  note: string;
}

export const INDICATORS: IndicatorMeta[] = [
  { id: 'GDP增长率', name: 'GDP 年增长率（%）', unit: '%', decimals: 2, note: '按不变价计算的国内生产总值年度同比增速，反映经济体扩张速度。' },
  { id: '人均GDP', name: '人均 GDP（现价美元）', unit: '美元', decimals: 0, note: '国内生产总值除以年中人口，反映人均产出水平。' },
  { id: '通货膨胀率', name: '居民消费价格指数 CPI 同比（%）', unit: '%', decimals: 2, note: '反映居民消费价格水平年度同比变化，是衡量通胀的核心指标。' },
  { id: '人口', name: '人口总量（人）', unit: '人', decimals: 0, note: '年中常住人口规模，反映经济体市场规模。' },
  { id: '城镇化率', name: '城镇化率（%）', unit: '%', decimals: 2, note: '城镇常住人口占常住总人口的比重，反映城市化发展水平。' },
  { id: '失业率', name: '失业率（%）', unit: '%', decimals: 2, note: '劳动力中失业人口所占比重，反映就业市场景气度。' },
];

export const ALL_COUNTRIES = [
  '中国', '美国', '日本', '德国', '英国', '法国', '印度', '巴西',
  '俄罗斯', '韩国', '加拿大', '澳大利亚', '意大利', '西班牙', '墨西哥',
  '印度尼西亚', '土耳其', '荷兰', '沙特阿拉伯', '瑞士', '新加坡', '南非',
];

/** 默认选中的核心经济体（首次加载避免一次请求过多国家） */
export const DEFAULT_COUNTRIES = ['中国', '美国', '日本', '德国', '英国', '法国', '印度', '巴西'];

export type ChartType = 'line' | 'bar' | 'area' | 'radar';

export const CHART_COLORS = ['#2563EB', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6', '#06B6D4'];

export const CHART_TYPE_NAME: Record<ChartType, string> = {
  line: '折线趋势图',
  bar: '柱状对比图',
  area: '面积走势图',
  radar: '雷达对比图',
};

/** 数值格式化（按指标小数位；人口用千分位） */
export function formatIndicatorValue(v: number, indicator: IndicatorMeta | undefined): string {
  if (indicator?.id === '人口') {
    return v.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
  }
  return v.toFixed(indicator?.decimals ?? 2);
}
