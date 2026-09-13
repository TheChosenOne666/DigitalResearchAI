import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PdfFontCandidate } from '../src/modules/report/export/pdf-font';

/**
 * 被测模块内部经 `resolveCjkFonts` 取字体，测试用可变数组控制其返回值：
 * 默认注入测试机真实可用字体（渲染类断言），清空后验证「无字体」异常分支。
 */
const fontCandidates: PdfFontCandidate[] = [];

vi.mock('../src/modules/report/export/pdf-font', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/report/export/pdf-font')>();
  return { ...actual, resolveCjkFonts: () => fontCandidates };
});

import { buildPdf } from '../src/modules/report/export/pdf.builder';
import type { ExportReport } from '../src/modules/report/export/word.builder';

/** 测试机真实字体解析（用于填充上面的可控数组） */
const realFont = await vi.importActual<typeof import('../src/modules/report/export/pdf-font')>(
  '../src/modules/report/export/pdf-font',
);

/** 测试机是否具备中文字体；无字体的环境**显式跳过**渲染类用例（不静默假绿） */
const cjkAvailable = realFont.resolveCjkFonts().length > 0;

beforeEach(() => {
  fontCandidates.length = 0;
  fontCandidates.push(...realFont.resolveCjkFonts());
});

const citedReport: ExportReport = {
  title: 'GDP 增长率对比研究',
  subtitle: '2026-09-10 · 覆盖 8 个国家/地区',
  contentMd:
    '## 一、核心结论\n全球经济增速放缓{c:2}，中国保持领先{c:1}。\n\n- 中国 **5.2%** 位居前列{c:1}\n- 美国增速回落\n\n| 国家 | 2023 | 2024 |\n| --- | --- | --- |\n| 中国 | 5.2 | 4.9 |\n| 美国 | 2.5 | 2.1 |\n',
  sources: [
    { idx: 2, name: 'IMF 世界经济展望', url: 'https://www.imf.org/weo', desc: 'IMF 年度展望报告' },
    { idx: 1, name: '世界银行 WDI', url: 'https://data.worldbank.org', desc: 'WDI 数据库' },
  ],
};

describe.skipIf(!cjkAvailable)('report/export/pdf.builder.buildPdf（渲染，需中文字体）', () => {
  it('生成合法 PDF（%PDF 头 + 体积合理）', async () => {
    const buf = await buildPdf(citedReport);
    expect(buf.subarray(0, 4).toString('ascii')).toBe('%PDF');
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('嵌入中文字体（PDF 内含字体文件描述，非标准字体兜底）', async () => {
    const buf = await buildPdf(citedReport);
    // 中文字体以 FontFile2（TrueType）形式嵌入，确认未退化为 Helvetica 输出乱码
    expect(buf.toString('latin1')).toContain('FontFile2');
  });

  it('含 {c:N} 引文与表格的报告可正常生成', async () => {
    const buf = await buildPdf(citedReport);
    expect(buf.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('无引文、无来源的报告可正常生成', async () => {
    const buf = await buildPdf({
      title: '纯文本报告',
      contentMd: '这是一段没有任何引文标记的正文。\n\n## 小节\n继续正文内容。',
      sources: [],
    });
    expect(buf.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('长报告自动分页（多页 PDF 的页对象数量增加）', async () => {
    const longMd = Array.from(
      { length: 60 },
      (_, i) => `## 第 ${i + 1} 节\n这是第 ${i + 1} 节的正文内容，用于验证长文档分页。{c:1}\n`,
    ).join('\n');
    const short = await buildPdf({ title: '短报告', contentMd: '一句话。', sources: [] });
    const long = await buildPdf({ title: '长报告', contentMd: longMd, sources: [] });
    const pagesOf = (b: Buffer) => (b.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pagesOf(long)).toBeGreaterThan(pagesOf(short));
  });
});

describe('report/export/pdf.builder.buildPdf（异常分支）', () => {
  it('未找到可用中文字体 → 抛业务异常并提示配置 PDF_FONT_PATH', async () => {
    fontCandidates.length = 0;
    await expect(buildPdf(citedReport)).rejects.toThrow(/PDF_FONT_PATH/);
  });
});

describe('report/export/pdf-font.resolveCjkFonts', () => {
  it('不存在的配置路径被忽略（不进入候选）', () => {
    const list = realFont.resolveCjkFonts('C:/__not_exist__/fake-font.ttf');
    expect(list.every((c) => c.path !== 'C:/__not_exist__/fake-font.ttf')).toBe(true);
  });

  it('存在的配置路径排在候选首位（配置优先于平台兜底）', () => {
    const first = realFont.resolveCjkFonts()[0];
    if (!first) return; // 测试机无中文字体，跳过
    const list = realFont.resolveCjkFonts(first.path);
    expect(list[0]?.path).toBe(first.path);
  });
});
