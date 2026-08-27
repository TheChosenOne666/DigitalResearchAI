import { Injectable, Logger } from '@nestjs/common';
import {
  fetchWdi,
  resolveCountryCodes,
  resolveIndicatorCodes,
} from '../search/connectors/vertical.connector';

/** 单条时序序列（某国家在某指标下的逐年值） */
export interface DatasetSeries {
  /** 国家/地区名（中文名，未知回退 ISO3） */
  country: string;
  /** ISO3 代码 */
  iso3: string;
  /** 年份 → 值（缺失年份无键） */
  values: Record<string, number>;
}

/** 单个指标的时序数据集 */
export interface DatasetIndicator {
  /** 指标中文名（或 WDI 代码） */
  indicator: string;
  /** WDI 指标代码 */
  indicatorCode: string;
  /** 各国时序序列 */
  series: DatasetSeries[];
}

/** 工作台数据集查询结果 */
export interface DatasetResult {
  /** 按指标分组的时序数据 */
  indicators: DatasetIndicator[];
  /** 升序年份列表（各指标年份并集） */
  years: string[];
  /** 数据来源标注 */
  source: string;
}

/**
 * 数据工作台服务（M4.1）：按国家/指标/年份取 WDI 结构化时序数据。
 * 复用智搜垂直路的 fetchWdi 与字典映射，输出「指标 × 国家 × 年份值」矩阵，
 * 区别于智搜路径的 Markdown 表格——供前端时序宽表直接渲染。
 */
@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  /**
   * 取时序数据集。单指标取数失败仅跳过该项，不阻断整体（与智搜熔断策略一致）。
   * @param countries 国家/地区名（中文名或 ISO3）
   * @param indicators 指标（中文名或 WDI 代码）
   * @param yearFrom 起始年份
   * @param yearTo 结束年份
   * @param signal 客户端断开中止信号
   */
  async getDataset(
    countries: string[],
    indicators: string[],
    yearFrom: number,
    yearTo: number,
    signal: AbortSignal,
  ): Promise<DatasetResult> {
    const countryCodes = resolveCountryCodes(countries);
    // code → 输入名映射（未知名字经 resolve 后与原样一致，保留原样展示）
    const codeToName: Record<string, string> = {};
    countryCodes.forEach((code, i) => {
      codeToName[code] = countries[i];
    });
    const resolved = resolveIndicatorCodes(indicators);

    const yearSet = new Set<string>();
    const out: DatasetIndicator[] = [];

    for (const { name, code } of resolved) {
      let obs: Awaited<ReturnType<typeof fetchWdi>> = [];
      try {
        obs = await fetchWdi(code, countryCodes, yearFrom, yearTo, signal);
      } catch (e) {
        this.logger.warn(`WDI 取数失败（${name}/${code}），跳过：${e instanceof Error ? e.message : e}`);
        continue;
      }
      // 按 ISO3 分组，逐年填值
      const byCountry = new Map<string, DatasetSeries>();
      for (const r of obs) {
        if (r.value == null) continue;
        yearSet.add(r.date);
        const key = r.countryiso3code;
        if (!byCountry.has(key)) {
          byCountry.set(key, {
            country: codeToName[key] ?? key,
            iso3: key,
            values: {},
          });
        }
        byCountry.get(key)!.values[r.date] = r.value;
      }
      if (byCountry.size === 0) continue;
      out.push({
        indicator: name,
        indicatorCode: code,
        series: [...byCountry.values()],
      });
    }

    return {
      indicators: out,
      years: [...yearSet].sort(),
      source: '世界发展指标数据库（WDI）',
    };
  }
}
