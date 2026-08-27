import { request } from '@/api/http';

/** 单条时序序列（某国家在某指标下的逐年值） */
export interface DatasetSeries {
  country: string;
  iso3: string;
  values: Record<string, number>;
}

/** 单个指标的时序数据集 */
export interface DatasetIndicator {
  indicator: string;
  indicatorCode: string;
  series: DatasetSeries[];
}

/** 工作台数据集查询结果 */
export interface DatasetResult {
  indicators: DatasetIndicator[];
  years: string[];
  source: string;
}

/**
 * 数据工作台时序数据查询（M4.1）：按国家/指标/年份取 WDI 结构化时序数据。
 */
export async function fetchDataset(params: {
  countries: string[];
  indicators: string[];
  yearFrom: number;
  yearTo: number;
}): Promise<DatasetResult> {
  const query = new URLSearchParams();
  query.set('countries', params.countries.join(','));
  query.set('indicators', params.indicators.join(','));
  query.set('yearFrom', String(params.yearFrom));
  query.set('yearTo', String(params.yearTo));
  return request(`/api/v1/workspace/dataset?${query.toString()}`);
}
