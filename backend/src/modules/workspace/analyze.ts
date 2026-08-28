/**
 * 分析结果页（M4.3）：时序数据 → 14 章节报告的确定性计算与 prompt/降级构建。
 * 纯函数模块，不依赖 Nest DI，便于单测。
 * 统计口径对齐原型 ssWSAnzBuild：均值简单算术平均、区间累计变动百分比、排名按末年值降序（缺失末位）。
 */

/** 单条时序序列 */
export interface AnalyzeSeries {
  /** 国家/地区名 */
  country: string;
  /** 年份 → 值（缺失年份无键） */
  values: Record<string, number>;
}

/** 来源项 */
export interface AnalyzeSource {
  name: string;
  url?: string;
  desc?: string;
  type: string;
}

/** 图表配置快照（随报告落 paramsSnapshot，供前端渲染/导出用） */
export interface AnalyzeChartConfig {
  type?: string;
  from?: number;
  to?: number;
  label?: boolean;
  grid?: boolean;
}

/** 分析输入（前端工作台把合并后的时序数据 + 来源 + 图表配置一并传入） */
export interface AnalyzeInput {
  indicator: { name: string; unit: string; note?: string; code?: string };
  /** 国家/地区名列表（参与分析） */
  countries: string[];
  /** 升序年份 */
  years: string[];
  series: AnalyzeSeries[];
  sources: AnalyzeSource[];
  chartConfig?: AnalyzeChartConfig;
  /** 可选：来源检索问题（分析背景用） */
  question?: string;
}

/** 统计卡片（5 枚） */
export interface AnalyzeStats {
  /** 样本覆盖（国家数） */
  sampleCount: number;
  /** 起止年份（如 2019-2025） */
  yearRange: string;
  /** 年份数 */
  yearCount: number;
  /** 期末均值（末年非空值平均） */
  endAvg: number | null;
  /** 区间变动百分比（首末均值差 / |首均值|，首均值为 0 或缺失为 null） */
  changePct: number | null;
  /** 数据完整率（%），非空单元格 / 总单元格 */
  completeness: number;
  /** 非空单元格数 */
  nonNull: number;
  /** 总单元格数 */
  totalCells: number;
}

/** 数据分析表 */
export interface AnalyzeTable {
  head: string[];
  rows: Array<Array<string | number>>;
}

/** 数值格式化（对齐原型 ssWSAnzFmt：整型单位取整，其余保留 1 位小数） */
export function fmtValue(v: number, unit: string): string {
  if (unit === '美元' || unit === '人' || unit === '百万人') {
    return String(Math.round(v));
  }
  return v.toFixed(1);
}

/** 取某年全部非空值的简单平均 */
function meanOf(values: Array<number | null>): number | null {
  const vs = values.filter((v): v is number => v != null);
  if (!vs.length) return null;
  return vs.reduce((a, b) => a + b, 0) / vs.length;
}

/** 取某年非空值中的极值（dir=1 最大，dir=-1 最小），返回国家名 + 值 */
function extOf(
  series: AnalyzeSeries[],
  year: string,
  dir: 1 | -1,
): { name: string; v: number } | null {
  let best: { name: string; v: number } | null = null;
  for (const r of series) {
    const v = r.values[year] ?? null;
    if (v == null) continue;
    if (best == null || (dir > 0 ? v > best.v : v < best.v)) best = { name: r.country, v };
  }
  return best;
}

/**
 * 计算统计卡片：样本覆盖/时间跨度/期末均值/区间变动/数据完整率。
 */
export function computeStats(series: AnalyzeSeries[], years: string[]): AnalyzeStats {
  const yFirst = years[0];
  const yLast = years[years.length - 1];
  const startVals: Array<number | null> = [];
  const endVals: Array<number | null> = [];
  let nonNull = 0;
  for (const r of series) {
    for (const y of years) {
      if (r.values[y] != null) nonNull++;
    }
    if (yFirst) startVals.push(r.values[yFirst] ?? null);
    if (yLast) endVals.push(r.values[yLast] ?? null);
  }
  const totalCells = series.length * years.length;
  const completeness = totalCells ? (nonNull / totalCells) * 100 : 0;
  const startAvg = meanOf(startVals);
  const endAvg = meanOf(endVals);
  const changePct =
    startAvg != null && endAvg != null && startAvg !== 0
      ? ((endAvg - startAvg) / Math.abs(startAvg)) * 100
      : null;
  return {
    sampleCount: series.length,
    yearRange: yFirst && yLast ? `${yFirst}-${yLast}` : '—',
    yearCount: years.length,
    endAvg,
    changePct,
    completeness,
    nonNull,
    totalCells,
  };
}

/**
 * 数据分析表：按末年值降序（缺失末位）取 Top N，缺失值以 '..' 占位。
 */
export function computeTable(
  series: AnalyzeSeries[],
  years: string[],
  unit: string,
  topN: number,
): AnalyzeTable {
  const yLast = years[years.length - 1];
  const ranked = [...series].sort((a, b) => {
    const x = yLast ? a.values[yLast] ?? null : null;
    const z = yLast ? b.values[yLast] ?? null : null;
    if (x == null && z == null) return 0;
    if (x == null) return 1;
    if (z == null) return -1;
    return z - x;
  });
  const head = ['国家/地区', ...years];
  const rows = ranked.slice(0, topN).map((r) => [
    r.country,
    ...years.map((y) => (r.values[y] == null ? '..' : fmtValue(r.values[y], unit))),
  ]);
  return { head, rows };
}

/** 14 章节固定结构（LLM 与降级路径共用，保证章节一致） */
export const ANALYZE_SECTIONS = [
  '一、报告摘要',
  '二、分析背景',
  '三、核心结论',
  '四、数据解读（Top 排名）',
  '五、逐经济体解读',
  '六、分年度趋势解读',
  '七、经济体分组对比',
  '八、趋势与差异分析',
  '九、指标口径说明',
  '十、数据分析表',
  '十一、数据来源',
  '十二、可视化图表',
  '十三、风险与展望',
  '十四、方法与数据质量说明',
] as const;

/** 构建分析 System prompt：14 章节固定结构 + 字数/准确性硬约束 */
const ANALYZE_SYSTEM =
  '你是「AI 数智研究平台」的资深宏观数据分析师，负责把给定的一组时序数据写成一份结构化分析报告。\n' +
  '输出要求（必须严格遵守）：\n' +
  '- 用 Markdown 输出，依次包含以下 14 个章节，每章用「一、二、三…」中文序号作为二级标题：\n' +
  '  ' +
  ANALYZE_SECTIONS.join('；') +
  '；\n' +
  '- 全文不少于 3000 字，每个章节都要有实质内容，避免空泛套话；\n' +
  '- 所有数据必须来自我提供的时序数据，不得编造或引用数据之外的具体数字；\n' +
  '- 引用数据时给出具体国家、年份与数值，并说明对比关系（领先/落后、上升/下降、幅度）；\n' +
  '- 「十、数据分析表」用 Markdown 表格，第一列为国家/地区，其余列为年份；\n' +
  '- 缺失值以「..」表示、不参与计算，正文中可提及数据完整率；\n' +
  '- 语言专业、克制，不写空泛的免责声明，也不使用「综上所述」之类的套话结尾。';

/**
 * 构建分析 prompt：把指标信息、时序数据矩阵、统计概览与来源作为上下文。
 */
export function buildAnalyzePrompt(
  input: AnalyzeInput,
  stats: AnalyzeStats,
  table: AnalyzeTable,
): { system: string; prompt: string } {
  const { indicator, series, years, sources } = input;
  const unit = indicator.unit || '';
  const seriesLines = series
    .map((r) => {
      const cells = years
        .map((y) => `${y}:${r.values[y] == null ? '..' : fmtValue(r.values[y], unit)}`)
        .join('，');
      return `${r.country}（${cells}）`;
    })
    .join('\n');
  const srcLines = sources
    .map((s, i) => `${i + 1}. ${s.name}${s.url ? `（${s.url}）` : ''}${s.desc ? ` - ${s.desc}` : ''}`)
    .join('\n');

  const tableMd =
    `| ${table.head.join(' | ')} |\n` +
    `| ${table.head.map(() => '---').join(' | ')} |\n` +
    table.rows.map((r) => `| ${r.join(' | ')} |`).join('\n');

  return {
    system: ANALYZE_SYSTEM,
    prompt:
      `分析任务：请基于以下时序数据，围绕「${indicator.name}」指标（单位：${unit}${indicator.note ? '，口径：' + indicator.note : ''}）撰写分析报告。\n\n` +
      `观测范围：${stats.sampleCount} 个国家/地区，${stats.yearRange}（${stats.yearCount} 个年份）。\n` +
      `数据完整率：${stats.completeness.toFixed(1)}%（${stats.nonNull}/${stats.totalCells} 单元格，缺失以「..」占位）。\n\n` +
      `完整时序数据（${series.length} 条）：\n${seriesLines}\n\n` +
      `按 ${years[years.length - 1]} 年降序的 Top ${table.rows.length} 数据表：\n${tableMd}\n\n` +
      `数据来源（${sources.length} 项）：\n${srcLines || '（未勾选外部来源，仅含指标库数据）'}\n\n` +
      `请严格按 14 章节结构输出，全文不少于 3000 字。`,
  };
}

/** 逐国解读文案（降级路径用，与 LLM 输出结构对齐） */
function countryLine(r: AnalyzeSeries, years: string[], unit: string, rank: number): string {
  const yFirst = years[0];
  const yLast = years[years.length - 1];
  const v0 = yFirst ? r.values[yFirst] ?? null : null;
  const v1 = yLast ? r.values[yLast] ?? null : null;
  let s = `【${r.country}】第 ${rank} 位：${yLast} 年 ${v1 == null ? '..' : fmtValue(v1, unit)}${unit}`;
  if (v0 != null && v1 != null) {
    const d = v1 - v0;
    const p = v0 !== 0 ? (d / Math.abs(v0)) * 100 : null;
    s += `，期初（${yFirst} 年）为 ${fmtValue(v0, unit)}${unit}，区间${d >= 0 ? '增加' : '减少'} ${fmtValue(Math.abs(d), unit)}${unit}`;
    if (p != null) s += `（${p >= 0 ? '+' : ''}${p.toFixed(1)}%）`;
    s += p != null && Math.abs(p) >= 10 ? '，变动幅度较大，值得重点关注。' : '，整体变动相对平稳。';
  } else if (v1 == null) {
    s += '，期末数据缺失（..），需结合其他年份研判。';
  }
  return s;
}

/** 经济体分组（发达/新兴/能源资源型，与原型一致） */
const GROUP_DEF: Array<{ name: string; members: string[] }> = [
  { name: '发达经济体', members: ['美国', '德国', '日本', '英国', '法国', '加拿大', '韩国', '澳大利亚', '意大利'] },
  { name: '新兴经济体', members: ['中国', '印度', '巴西', '印尼', '墨西哥', '土耳其', '南非', '印度尼西亚'] },
  { name: '能源资源型', members: ['俄罗斯', '沙特', '沙特阿拉伯'] },
];

/**
 * 确定性降级报告：无 ARK_API_KEY 或 LLM 失败时输出与 LLM 同结构的 14 章节 Markdown。
 * 数字全部来自 stats/table，文字用模板，保证页面完整可渲染且内容量充足。
 */
export function buildFallbackReport(
  input: AnalyzeInput,
  stats: AnalyzeStats,
  table: AnalyzeTable,
): string {
  const { indicator, series, years, sources } = input;
  const unit = indicator.unit || '';
  const yFirst = years[0] ?? '';
  const yLast = years[years.length - 1] ?? '';
  const f = (v: number) => fmtValue(v, unit);

  // 排名（按末年降序，缺失末位）
  const ranked = [...series].sort((a, b) => {
    const x = yLast ? a.values[yLast] ?? null : null;
    const z = yLast ? b.values[yLast] ?? null : null;
    if (x == null && z == null) return 0;
    if (x == null) return 1;
    if (z == null) return -1;
    return z - x;
  });
  const top = ranked.slice(0, 8);
  const t1 = top[0];
  const t2 = top[1];
  const endMax = ranked.find((r) => yLast && r.values[yLast] != null);
  const endMin = [...ranked].reverse().find((r) => yLast && r.values[yLast] != null);

  const statsLine = `${stats.sampleCount} 个国家/地区、${stats.yearRange}（${stats.yearCount} 个年份）`;
  const completenessLine = `数据完整率为 ${stats.completeness.toFixed(1)}%（${stats.nonNull}/${stats.totalCells} 单元格），缺失值以「..」标准化占位、不参与计算`;

  const md: string[] = [];

  // 一、报告摘要
  md.push('## 一、报告摘要');
  let summary = `本报告围绕「${indicator.name}」指标，对 ${statsLine} 的数据进行系统性再分析。`;
  if (endMax && endMin) {
    summary += `从期末（${yLast} 年）数据看，${endMax.country} 以 ${f(endMax.values[yLast]!)}${unit} 位居首位，${endMin.country}（${f(endMin.values[yLast]!)}${unit}）处于末位，首尾差距明显。`;
  }
  if (stats.endAvg != null) {
    summary += `样本均值在期末（${yLast} 年）为 ${f(stats.endAvg)}${unit}`;
    if (stats.changePct != null) summary += `，区间累计${stats.changePct >= 0 ? '上升' : '下降'} ${Math.abs(stats.changePct).toFixed(1)}%`;
    summary += '。';
  }
  summary += `${completenessLine}。报告从总体走势、逐国变化、年度节奏、经济体分组差异、风险展望等维度展开解读，并结合数据分析表给出证据，供研究参考与二次加工。`;
  md.push(summary);

  // 二、分析背景
  md.push('## 二、分析背景');
  md.push(
    `本次分析聚焦「${indicator.name}」指标，覆盖 ${stats.sampleCount} 个国家/地区、${stats.yearCount} 个年份（${stats.yearRange}）。` +
      `数据来源共 ${sources.length} 项${sources.length ? '：' + sources.map((s) => s.name).join('、') : '（未勾选外部来源，仅含指标库数据）'}。` +
      `${input.question ? `分析问题源于「${input.question}」。` : ''}` +
      `报告严格基于所提供时序数据计算，缺失值不参与均值与增速计算，以保证结论可复现。`,
  );

  // 三、核心结论
  md.push('## 三、核心结论');
  let core = `本报告基于「${indicator.name}」指标，对 ${statsLine} 的数据进行再次分析。`;
  if (t1) {
    core += `${t1.country} 以 ${f(t1.values[yLast]!)}${unit} 位居首位`;
    if (t2 && t2.values[yLast] != null) core += `，${t2.country}（${f(t2.values[yLast])}${unit}）紧随其后`;
    core += '。';
  }
  core += `整体样本${series.length > 1 ? '呈分化态势' : '分布稳定'}，期末均值为 ${stats.endAvg == null ? '..' : f(stats.endAvg)}${unit}，建议结合产业政策与库存周期做多周期交叉验证。`;
  md.push(core);

  // 四、数据解读（Top 8）
  md.push(`## 四、数据解读（Top ${top.length}）`);
  const reads = top.map((r, i) => {
    const v0 = yFirst ? r.values[yFirst] ?? null : null;
    const v1 = yLast ? r.values[yLast] ?? null : null;
    let s = `${i + 1}. ${r.country}：${yLast} 年 ${v1 == null ? '..' : f(v1)}${unit}`;
    if (v0 != null && v1 != null) {
      const d = v1 - v0;
      const p = v0 !== 0 ? (d / Math.abs(v0)) * 100 : null;
      s += `，较 ${yFirst} 年${d >= 0 ? '上升' : '下降'} ${f(Math.abs(d))}${unit}`;
      if (p != null) s += `（${p >= 0 ? '+' : ''}${p.toFixed(1)}%）`;
    } else if (v1 == null) {
      s += '，期末数据缺失（..）';
    }
    return s + '；';
  });
  md.push(...reads.map((s) => `- ${s}`));

  // 五、逐经济体解读
  md.push(`## 五、逐经济体解读（${series.length} 个）`);
  md.push(...ranked.map((r, i) => `- ${countryLine(r, years, unit, i + 1)}`));

  // 六、分年度趋势解读
  md.push('## 六、分年度趋势解读');
  let prevAvg: number | null = null;
  const yearly: string[] = [];
  for (const y of years) {
    const vs = series.map((r) => r.values[y] ?? null);
    const mv = meanOf(vs);
    const valid = vs.filter((v): v is number => v != null);
    const mx = extOf(series, y, 1);
    const mn = extOf(series, y, -1);
    let line = `${y} 年：样本均值 ${mv == null ? '..' : f(mv)}${unit}（${valid.length} 个样本）`;
    if (mx) line += `，最高 ${mx.name}（${f(mx.v)}${unit}）`;
    if (mn) line += `，最低 ${mn.name}（${f(mn.v)}${unit}）`;
    if (prevAvg != null && mv != null) {
      const d = mv - prevAvg;
      line += `，较上年均值${d >= 0 ? '上升' : '下降'} ${f(Math.abs(d))}${unit}，样本整体${d >= 0 ? '扩张' : '收敛'}。`;
    } else if (mv != null) {
      line += '，为观察期基准水平。';
    }
    prevAvg = mv;
    yearly.push(line);
  }
  md.push(...yearly.map((s) => `- ${s}`));

  // 七、经济体分组对比
  md.push('## 七、经济体分组对比');
  const groupLines = GROUP_DEF.map((g) => {
    const members = series.filter((r) => g.members.includes(r.country));
    const vs1 = members.map((r) => (yLast ? r.values[yLast] ?? null : null)).filter((v): v is number => v != null);
    const vs0 = members.map((r) => (yFirst ? r.values[yFirst] ?? null : null)).filter((v): v is number => v != null);
    const m1 = vs1.length ? vs1.reduce((a, b) => a + b, 0) / vs1.length : null;
    const m0 = vs0.length ? vs0.reduce((a, b) => a + b, 0) / vs0.length : null;
    const gv = m0 != null && m1 != null && m0 !== 0 ? ((m1 - m0) / Math.abs(m0)) * 100 : null;
    let s = `${g.name}（${members.length} 个样本）：期末均值 ${m1 == null ? '..' : f(m1)}${unit}`;
    if (m0 != null && m1 != null) s += `，期初为 ${f(m0)}${unit}，区间累计${gv != null && gv >= 0 ? '上升' : '下降'} ${gv == null ? '—' : Math.abs(gv).toFixed(1) + '%'}`;
    return s + '；';
  });
  md.push(...groupLines.map((s) => `- ${s}`));

  // 八、趋势与差异分析
  md.push('## 八、趋势与差异分析');
  let trend = '';
  if (t1 && t2 && t1.values[yLast] != null && t2.values[yLast] != null) {
    const gap = t1.values[yLast] - t2.values[yLast];
    trend = `${t1.country} 与 ${t2.country} 在 ${yLast} 年的差距为 ${f(Math.abs(gap))}${unit}（${gap >= 0 ? t1.country + ' 领先' : t2.country + ' 领先'}）。`;
  } else if (t1) {
    trend = `${t1.country} 在 ${stats.yearRange} 区间内为领先经济体。`;
  }
  if (endMax && endMin && endMax.values[yLast] != null && endMin.values[yLast] != null) {
    const gap = endMax.values[yLast] - endMin.values[yLast];
    if (gap !== 0) {
      trend += `期末头部与尾部差距为 ${f(Math.abs(gap))}${unit}，内部差异${Math.abs(gap) / Math.abs(endMax.values[yLast]) > 0.5 ? '较大，呈明显分化格局' : '处于中等水平'}。`;
    }
  }
  trend += '建议关注增长最快经济体的结构性驱动因素，以及头部与尾部差距的收敛或扩大趋势。';
  md.push(trend);

  // 九、指标口径说明
  md.push('## 九、指标口径说明');
  md.push(
    `指标名称：${indicator.name}（单位：${unit || '—'}）。${indicator.note || ''} 数据采用统一统计口径与年度频率，便于跨经济体横向比较；缺失值以「..」占位、不参与计算。`,
  );

  // 十、数据分析表
  md.push('## 十、数据分析表');
  md.push(
    `| ${table.head.join(' | ')} |\n| ${table.head.map(() => '---').join(' | ')} |\n` +
      table.rows.map((r) => `| ${r.join(' | ')} |`).join('\n'),
  );

  // 十一、数据来源
  md.push('## 十一、数据来源');
  if (sources.length) {
    md.push(...sources.map((s, i) => `- ${i + 1}. ${s.name}${s.url ? `（${s.url}）` : ''}${s.desc ? ` - ${s.desc}` : ''}`));
  } else {
    md.push('未勾选外部来源，仅包含指标库与本地补充数据。');
  }

  // 十二、可视化图表（降级路径无图表，说明勾选类型）
  md.push('## 十二、可视化图表');
  const chartTypeName: Record<string, string> = { line: '折线趋势图', bar: '柱状对比图', area: '面积走势图', radar: '雷达对比图' };
  const ct = input.chartConfig?.type && chartTypeName[input.chartConfig.type] ? chartTypeName[input.chartConfig.type] : '折线趋势图';
  md.push(`本报告随附「${ct}」图表，基于当前勾选类型与 ${input.chartConfig?.from ?? years[0] ?? '-'}-${input.chartConfig?.to ?? years[years.length - 1] ?? '-'} 时间区间生成，供正文结论交叉印证。`);

  // 十三、风险与展望
  md.push('## 十三、风险与展望');
  md.push(
    '展望未来，样本经济体在该指标上的演变将受多重因素影响：一是外部政策与地缘环境变化，可能通过贸易、能源与供应链渠道传导至经济基本面；二是数据口径与统计修订差异，跨经济体比较时需注意可比性；三是结构性因素（人口结构、产业转型、技术创新）将决定中长期分化方向。建议将本报告结论与最新一期官方数据、行业研究报告交叉验证，并重点关注期末排名靠前、增速较快经济体的后续走势。',
  );

  // 十四、方法与数据质量说明
  md.push('## 十四、方法与数据质量说明');
  md.push(
    `分析方法说明：样本为国家/地区维度，观察期为 ${stats.yearRange}；缺失值以「..」占位且不参与均值与增速计算；排名按 ${yLast} 年数据降序（缺失排在末位）；均值采用简单算术平均；增速采用区间累计变动百分比；分组对比按经济体发展阶段与资源禀赋划分，仅为研究参考。本结果由 AI 自动生成，数据以官方发布为准。`,
  );

  md.push('');
  md.push(`> 数据完整率：${stats.completeness.toFixed(1)}% · 缺失值以「..」占位 · 本结果由 AI 自动生成，仅供研究参考。`);

  return md.join('\n\n');
}
