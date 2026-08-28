import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { buildWord, type ExportReport } from '../src/modules/report/export/word.builder';
import { buildPpt } from '../src/modules/report/export/ppt.builder';

/** 经 docx 包解析 jszip（pnpm 隔离布局下 jszip 是 docx 的传递依赖） */
const docxRequire = createRequire(require.resolve('docx'));
const JSZip = docxRequire('jszip');

/** 解包 docx/pptx（本质是 zip）取指定文件文本 */
async function unzipText(buffer: Buffer, path: string): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file(path);
  if (!file) throw new Error(`zip 内不存在 ${path}`);
  return file.async('string');
}

const citedReport: ExportReport = {
  title: 'GDP 增长率对比研究',
  subtitle: '2026-08-28 · 覆盖 8 个国家/地区',
  contentMd:
    '## 一、核心结论\n全球经济增速放缓{c:2}，中国保持领先{c:1}。\n\n- 中国 **5.2%** 位居前列{c:1}\n- 美国增速回落\n\n| 国家 | 2023 | 2024 |\n| --- | --- | --- |\n| 中国 | 5.2 | 4.9 |\n',
  sources: [
    { idx: 2, name: 'IMF 世界经济展望', url: 'https://www.imf.org/weo', desc: 'IMF 年度展望报告' },
    { idx: 1, name: '世界银行 WDI', url: 'https://data.worldbank.org', desc: 'WDI 数据库' },
  ],
};

describe('report/export/word.builder.buildWord', () => {
  it('生成合法 .docx（PK zip 头 + document.xml 存在）', async () => {
    const buf = await buildWord(citedReport);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 2).toString('ascii')).toBe('PK');
    const xml = await unzipText(buf, 'word/document.xml');
    expect(xml).toContain('GDP 增长率对比研究');
  });

  it('{c:N} 引文转 Word 上标 [N]（superscript）', async () => {
    const buf = await buildWord(citedReport);
    const xml = await unzipText(buf, 'word/document.xml');
    expect(xml).toContain('[1]');
    expect(xml).toContain('[2]');
    expect(xml).toContain('superscript');
  });

  it('来源表按 idx 升序（[1] 世界银行在 [2] IMF 之前）', async () => {
    const buf = await buildWord(citedReport);
    const xml = await unzipText(buf, 'word/document.xml');
    // 来源表在文末，取最后一次出现（正文引文在来源表之前）
    const src1 = xml.lastIndexOf('[1]');
    const src2 = xml.lastIndexOf('[2]');
    expect(src1).toBeGreaterThan(-1);
    expect(src2).toBeGreaterThan(-1);
    expect(src1).toBeLessThan(src2);
    expect(xml).toContain('世界银行 WDI');
    expect(xml).toContain('IMF 世界经济展望');
  });

  it('无引文报告（分析结果）正常生成，来源为空给占位文案', async () => {
    const buf = await buildWord({
      title: '分析结果报告',
      contentMd: '## 一、报告摘要\n全部指标稳定增长。',
      sources: [],
    });
    const xml = await unzipText(buf, 'word/document.xml');
    expect(xml).toContain('分析结果报告');
    expect(xml).toContain('未勾选外部来源');
    expect(xml).not.toContain('superscript');
  });
});

describe('report/export/ppt.builder.buildPpt', () => {
  it('生成合法 .pptx（PK zip 头，含封面标题与来源页）', async () => {
    const buf = await buildPpt(citedReport);
    expect(buf.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(buf.length).toBeGreaterThan(1000);
    const presentation = await unzipText(buf, 'ppt/presentation.xml');
    expect(presentation).toContain('presentation');
  });

  it('无来源时来源页占位不崩溃', async () => {
    const buf = await buildPpt({
      title: '简单报告',
      contentMd: '摘要内容',
      sources: [],
    });
    expect(buf.subarray(0, 2).toString('ascii')).toBe('PK');
  });
});
