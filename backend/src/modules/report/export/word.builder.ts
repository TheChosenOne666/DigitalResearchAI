/**
 * 报告导出 · Word（.docx）构建器。
 *
 * 把报告（标题 + Markdown 正文 + 来源列表）渲染为 .docx Buffer：
 * - Markdown 块级结构（标题/段落/列表/表格）→ docx 对应结构；
 * - 行内 `{c:N}` 引文标记 → Word 上标 `[N]`（superScript）；
 * - 文末按 idx 升序生成「参考来源」表（引文编号 ↔ 来源映射）。
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from 'docx';
import {
  parseMarkdown,
  inlineToText,
  type MarkdownBlock,
  type Inline,
} from './markdown';

/** 导出用来源项（兼容智搜 search_sources 与分析结果 sources 两种形状） */
export interface ExportSource {
  idx: number;
  name: string;
  url?: string | null;
  desc?: string;
}

/** 报告导出统一输入 */
export interface ExportReport {
  title: string;
  contentMd: string;
  sources: ExportSource[];
  /** 副标题信息（生成时间/指标等，可选） */
  subtitle?: string;
}

/** 行内节点 → docx TextRun[]（引文转上标 [N]） */
function inlinesToRuns(inlines: Inline[]): TextRun[] {
  return inlines.map((x) => {
    if (x.kind === 'citation') {
      return new TextRun({ text: `[${x.n}]`, superScript: true, color: '2563EB' });
    }
    return new TextRun({ text: x.text, bold: x.kind === 'bold' });
  });
}

/** 单个块 → docx Paragraph/Table 数组 */
function blockToDocx(block: MarkdownBlock): (Paragraph | Table)[] {
  switch (block.type) {
    case 'heading': {
      const level = block.level === 1
        ? HeadingLevel.HEADING_1
        : block.level === 2
          ? HeadingLevel.HEADING_2
          : HeadingLevel.HEADING_3;
      return [
        new Paragraph({
          heading: level,
          children: inlinesToRuns(block.inlines),
          spacing: { before: 240, after: 120 },
        }),
      ];
    }
    case 'paragraph':
      return [
        new Paragraph({
          children: inlinesToRuns(block.inlines),
          spacing: { after: 120 },
        }),
      ];
    case 'list':
      return block.items.map(
        (item) =>
          new Paragraph({
            bullet: { level: 0 },
            children: inlinesToRuns(item),
            spacing: { after: 60 },
          }),
      );
    case 'table': {
      const headRow = new TableRow({
        children: block.head.map(
          (c) =>
            new TableCell({
              children: [new Paragraph({ children: inlinesToRuns(c) })],
              shading: { fill: 'F1F5F9' },
            }),
        ),
      });
      const bodyRows = block.rows.map(
        (row) =>
          new TableRow({
            children: row.map(
              (c) =>
                new TableCell({
                  children: [new Paragraph({ children: inlinesToRuns(c) })],
                }),
            ),
          }),
      );
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [headRow, ...bodyRows],
          borders: {
            insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'D9E2EC' },
            insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'D9E2EC' },
            top: { style: BorderStyle.SINGLE, size: 1, color: 'D9E2EC' },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'D9E2EC' },
            left: { style: BorderStyle.SINGLE, size: 1, color: 'D9E2EC' },
            right: { style: BorderStyle.SINGLE, size: 1, color: 'D9E2EC' },
          },
        }),
      ];
    }
  }
}

/** 来源表（引文编号 ↔ 来源映射） */
function buildSourcesTable(sources: ExportSource[]): Paragraph[] {
  const sorted = [...sources].sort((a, b) => a.idx - b.idx);
  const paragraphs: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: `参考来源（${sorted.length}）` })],
      spacing: { before: 240, after: 120 },
    }),
  ];
  if (!sorted.length) {
    paragraphs.push(new Paragraph({ children: [new TextRun({ text: '未勾选外部来源。' })] }));
    return paragraphs;
  }
  for (const s of sorted) {
    const runs: TextRun[] = [new TextRun({ text: `[${s.idx}] `, superScript: true, color: '2563EB' })];
    runs.push(new TextRun({ text: s.name, bold: true }));
    if (s.url) runs.push(new TextRun({ text: `  ${s.url}`, color: '2563EB' }));
    if (s.desc) runs.push(new TextRun({ text: `  ${s.desc}` }));
    paragraphs.push(new Paragraph({ children: runs, spacing: { after: 80 } }));
  }
  return paragraphs;
}

/**
 * 报告 → .docx Buffer。
 * @param report 统一导出输入（标题/正文/来源）
 */
export async function buildWord(report: ExportReport): Promise<Buffer> {
  const blocks = parseMarkdown(report.contentMd);
  const children: (Paragraph | Table)[] = [];

  // 文档标题 + 副标题
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: 'center',
      children: [new TextRun({ text: report.title, bold: true })],
    }),
  );
  if (report.subtitle) {
    children.push(
      new Paragraph({
        alignment: 'center',
        children: [new TextRun({ text: report.subtitle, color: '64748B', size: 18 })],
        spacing: { after: 200 },
      }),
    );
  }

  // 正文块
  for (const block of blocks) {
    children.push(...blockToDocx(block));
  }

  // 文末来源表（引文映射）
  children.push(...buildSourcesTable(report.sources));

  const doc = new Document({
    creator: 'AI数智研究平台',
    title: report.title,
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}
