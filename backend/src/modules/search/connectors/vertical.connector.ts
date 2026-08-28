import { Injectable } from '@nestjs/common';
import type {
  ConnectorInput,
  SearchConnector,
  SearchHit,
  SourceType,
} from './connector.interface';

/** 世界银行 WDI API 基地址（免费、无需 Key） */
const WDI_BASE = 'https://api.worldbank.org/v2';

/** 中文国家/地区名 → ISO3 代码（覆盖常用经济体） */
export const COUNTRY_ISO3: Record<string, string> = {
  中国: 'CHN',
  美国: 'USA',
  日本: 'JPN',
  德国: 'DEU',
  英国: 'GBR',
  法国: 'FRA',
  印度: 'IND',
  巴西: 'BRA',
  俄罗斯: 'RUS',
  韩国: 'KOR',
  加拿大: 'CAN',
  澳大利亚: 'AUS',
  意大利: 'ITA',
  西班牙: 'ESP',
  墨西哥: 'MEX',
  印度尼西亚: 'IDN',
  土耳其: 'TUR',
  荷兰: 'NLD',
  沙特阿拉伯: 'SAU',
  瑞士: 'CHE',
  新加坡: 'SGP',
  中国香港: 'HKG',
  中国台湾: 'TWN',
  越南: 'VNM',
  泰国: 'THA',
  马来西亚: 'MYS',
  阿根廷: 'ARG',
  南非: 'ZAF',
  埃及: 'EGY',
  尼日利亚: 'NGA',
  波兰: 'POL',
  瑞典: 'SWE',
  比利时: 'BEL',
  奥地利: 'AUT',
  挪威: 'NOR',
  丹麦: 'DNK',
  芬兰: 'FIN',
  以色列: 'ISR',
  阿联酋: 'ARE',
};

/** 标准指标中文名 → WDI 指标代码 */
export const INDICATOR_WDI: Record<string, string> = {
  GDP: 'NY.GDP.MKTP.CD',
  国内生产总值: 'NY.GDP.MKTP.CD',
  '人均GDP': 'NY.GDP.PCAP.CD',
  'GDP增长率': 'NY.GDP.MKTP.KD.ZG',
  人口: 'SP.POP.TOTL',
  '人口总数': 'SP.POP.TOTL',
  '人均GNI': 'NY.GNP.PCAP.CD',
  '通货膨胀率': 'FP.CPI.TOTL.ZG',
  '消费者物价指数': 'FP.CPI.TOTL.ZG',
  失业率: 'SL.UEM.TOTL.ZS',
  '外商直接投资': 'BX.KLT.DINV.CD.WD',
  '商品出口': 'TX.VAL.MRCH.CD.WT',
  '商品进口': 'TM.VAL.MRCH.CD.WT',
  '政府债务率': 'GC.DOD.TOTL.GD.ZS',
  '外汇储备': 'FI.RES.TOTL.CD',
  '城镇化率': 'SP.URB.TOTL.IN.ZS',
  '预期寿命': 'SP.DYN.LE00.IN',
  '儿童死亡率': 'SH.DYN.MORT',
  '识字率': 'SE.ADT.LITR.ZS',
  '二氧化碳排放': 'EN.ATM.CO2E.KT',
  '发电量': 'EG.ELC.PROD.KH',
  '互联网普及率': 'IT.NET.USER.ZS',
  '研发投入': 'GB.XPD.RSDV.GD.ZS',
  '高等教育入学率': 'SE.TER.ENRR',
};

/** WDI 单条观测 */
export interface WdiObservation {
  countryiso3code: string;
  date: string;
  value: number | null;
  indicator: { value: string | null };
}

/** 解析国家名为 ISO3（支持中文名/ISO3/英文名混合，未知原样保留大写） */
export function resolveCountryCodes(names: string[]): string[] {
  return names.map((n) => COUNTRY_ISO3[n] ?? n.toUpperCase());
}

/** 解析指标名为 WDI 代码（支持中文名/代码混合，未知原样保留） */
export function resolveIndicatorCodes(
  names: string[],
): { name: string; code: string }[] {
  return names.map((n) => ({ name: n, code: INDICATOR_WDI[n] ?? n }));
}

/**
 * 拉取 WDI 时序（独立函数，便于单测 mock）。
 * @see https://api.worldbank.org/v2/country/{codes}/indicator/{code}
 */
export async function fetchWdi(
  indicatorCode: string,
  countryCodes: string[],
  from: number,
  to: number,
  signal: AbortSignal,
): Promise<WdiObservation[]> {
  const url =
    `${WDI_BASE}/country/${countryCodes.join(';')}/indicator/${indicatorCode}` +
    `?date=${from}:${to}&format=json&per_page=100&source=2`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`WDI HTTP ${res.status} for ${indicatorCode}`);
  const json: unknown = await res.json();
  if (Array.isArray(json) && Array.isArray((json as unknown[])[1])) {
    return (json as unknown[])[1] as WdiObservation[];
  }
  return [];
}

/**
 * WDI 观测 → 表格 Markdown（纯函数，便于单测）。
 * 列 = 各国家，行 = 年份，缺失年份跳过。
 */
export function wdiToTableMarkdown(
  rows: WdiObservation[],
  ctx: { indicatorName: string; countryNames: Record<string, string> },
): string {
  const byCountry = new Map<string, Map<string, number>>();
  const yearSet = new Set<string>();
  for (const r of rows) {
    if (r.value == null) continue;
    yearSet.add(r.date);
    if (!byCountry.has(r.countryiso3code)) byCountry.set(r.countryiso3code, new Map());
    byCountry.get(r.countryiso3code)!.set(r.date, r.value);
  }
  const years = [...yearSet].sort();
  const countries = [...byCountry.keys()];
  if (!countries.length || !years.length) return '';

  const fmt = (v: number) =>
    v.toLocaleString('zh-CN', { maximumFractionDigits: 2 });

  let md = `### ${ctx.indicatorName}\n\n`;
  md += `| 年份 | ${countries.map((c) => ctx.countryNames[c] ?? c).join(' | ')} |\n`;
  md += `| --- | ${countries.map(() => '---').join(' | ')} |\n`;
  for (const y of years) {
    const cells = countries.map((c) => {
      const v = byCountry.get(c)!.get(y);
      return v == null ? '—' : fmt(v);
    });
    md += `| ${y} | ${cells.join(' | ')} |\n`;
  }
  return md;
}

/**
 * 世界银行 WDI 垂直路连接器（M2.1）。
 * 按意图的 countries/indicators/year 查 WDI，映射成时序表格 Markdown。
 * 无条件（无国家或无指标）时不查，返回空。
 */
@Injectable()
export class VerticalWorldBankConnector implements SearchConnector {
  readonly sourceType: SourceType = 'vertical';

  async search(input: ConnectorInput, signal: AbortSignal): Promise<SearchHit[]> {
    const { conditions } = input;
    const countries = conditions.countries ?? [];
    const indicators = conditions.indicators ?? [];
    if (!countries.length || !indicators.length) return [];

    const yearTo = conditions.yearTo ?? new Date().getFullYear() - 1;
    const yearFrom = conditions.yearFrom ?? yearTo - 10;
    const countryCodes = resolveCountryCodes(countries);
    const countryNames: Record<string, string> = {};
    countryCodes.forEach((code, i) => {
      countryNames[code] = countries[i];
    });
    const resolved = resolveIndicatorCodes(indicators);

    const hits: SearchHit[] = [];
    for (const { name, code } of resolved) {
      let obs: WdiObservation[] = [];
      try {
        obs = await fetchWdi(code, countryCodes, yearFrom, yearTo, signal);
      } catch {
        // 单指标失败不阻断整体，跳过该项
        continue;
      }
      const md = wdiToTableMarkdown(obs, { indicatorName: name, countryNames });
      if (!md) continue;
      hits.push({
        title: `${name}（${countries.join('、')}）`,
        snippet: `世界银行 WDI：${name}（${yearFrom}–${yearTo}）`,
        contentMd: md,
        sourceType: 'vertical',
        url: `https://data.worldbank.org/indicator/${code}`,
        meta: { indicator: name, indicatorCode: code, yearFrom, yearTo },
      });
    }
    return hits;
  }
}
