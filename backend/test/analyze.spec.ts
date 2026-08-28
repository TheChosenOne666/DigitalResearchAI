import { describe, it, expect } from 'vitest';
import {
  computeStats,
  computeTable,
  buildAnalyzePrompt,
  buildFallbackReport,
  ANALYZE_SECTIONS,
  type AnalyzeInput,
} from '../src/modules/workspace/analyze';

const input = (over: Partial<AnalyzeInput> = {}): AnalyzeInput => ({
  indicator: { name: 'GDP 年增长率（%）', unit: '%' },
  countries: ['中国', '美国'],
  years: ['2020', '2021'],
  series: [
    { country: '中国', values: { '2020': 2.0, '2021': 4.0 } },
    { country: '美国', values: { '2020': 1.0, '2021': 3.0 } },
  ],
  sources: [{ name: '世界银行 WDI', url: 'https://data.worldbank.org', type: 'vertical' }],
  ...over,
});

describe('computeStats', () => {
  it('计算样本覆盖/时间跨度/期末均值/区间变动/完整率', () => {
    const stats = computeStats(input().series, input().years);
    expect(stats.sampleCount).toBe(2);
    expect(stats.yearRange).toBe('2020-2021');
    expect(stats.yearCount).toBe(2);
    expect(stats.endAvg).toBeCloseTo(3.5);
    expect(stats.changePct).toBeCloseTo((3.5 - 1.5) / 1.5 * 100);
    expect(stats.completeness).toBe(100);
    expect(stats.nonNull).toBe(4);
    expect(stats.totalCells).toBe(4);
  });

  it('缺失值不参与均值；首均值为 0 时变动为 null', () => {
    const s = computeStats(
      [
        { country: 'A', values: { '2020': 0, '2021': 5 } },
        { country: 'B', values: {} },
      ],
      ['2020', '2021'],
    );
    expect(s.endAvg).toBeCloseTo(5);
    expect(s.changePct).toBeNull(); // 首均值 0，变动无法计算
    expect(s.completeness).toBeCloseTo(50); // A 有 2020/2021 两个值，B 全缺失：2/4
  });
});

describe('computeTable', () => {
  it('按末年值降序，缺失排末位并以 .. 占位', () => {
    const t = computeTable(
      [
        { country: 'A', values: { '2020': 1, '2021': 3 } },
        { country: 'B', values: { '2020': 2, '2021': 9 } },
        { country: 'C', values: { '2020': 5 } }, // 末年缺失
      ],
      ['2020', '2021'],
      '%',
      8,
    );
    expect(t.head).toEqual(['国家/地区', '2020', '2021']);
    expect(t.rows.map((r) => r[0])).toEqual(['B', 'A', 'C']);
    expect(t.rows[2]).toEqual(['C', '5.0', '..']);
  });
});

describe('buildAnalyzePrompt', () => {
  it('system 含 14 章节约束，prompt 含数据与来源', () => {
    const data = input();
    const stats = computeStats(data.series, data.years);
    const table = computeTable(data.series, data.years, '%', 8);
    const { system, prompt } = buildAnalyzePrompt(data, stats, table);
    expect(system).toContain('不少于 3000 字');
    for (const sec of ANALYZE_SECTIONS) expect(system).toContain(sec);
    expect(prompt).toContain('GDP 年增长率');
    expect(prompt).toContain('中国');
    expect(prompt).toContain('世界银行 WDI');
  });
});

describe('buildFallbackReport', () => {
  it('降级报告含全部 14 章节、数据表与来源', () => {
    const data = input();
    const stats = computeStats(data.series, data.years);
    const table = computeTable(data.series, data.years, '%', 8);
    const md = buildFallbackReport(data, stats, table);
    for (const sec of ANALYZE_SECTIONS) {
      if (sec.startsWith('四、')) {
        expect(md).toMatch(/## 四、数据解读（Top \d+）/);
      } else {
        expect(md).toContain('## ' + sec);
      }
    }
    expect(md).toContain('| 国家/地区 | 2020 | 2021 |');
    expect(md).toContain('世界银行 WDI');
    expect(md.length).toBeGreaterThan(1000);
  });
});
