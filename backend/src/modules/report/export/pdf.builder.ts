/**
 * 报告导出 · PDF（.pdf）构建器。
 *
 * 把报告（标题 + Markdown 正文 + 来源列表）渲染为 .pdf Buffer：
 * - 复用 `./markdown` 的块级解析（标题/段落/列表/表格），与 Word 导出口径一致；
 * - 行内 `{c:N}` 引文标记 → 主题色小字号 `[N]`（近似上标，见下方 CITE_SCALE 说明）；
 * - 文末按 idx 升序生成「参考来源」清单；
 * - 中文字体必须显式嵌入（PDF 标准字体不含中文字形），字体来源见 `./pdf-font`。
 *
 * 已知限制：
 * - pdfkit 0.20 运行时不支持 `superscript`，引文以「缩小字号 + 主题色」替代真上标；
 * - 未注册独立粗体字体，`**加粗**` 与正文同字重（保持内容不丢，不做视觉加粗）。
 */

import { HttpStatus, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { ErrorCode } from '@app/shared';
import { BizException } from '../../../common/exceptions/biz.exception';
import { parseMarkdown, type Inline, type MarkdownBlock } from './markdown';
import type { ExportReport, ExportSource } from './word.builder';
import { resolveCjkFonts, type PdfFontCandidate } from './pdf-font';

/** A4 页面宽度（点，72pt = 1 英寸） */
const PAGE_WIDTH = 595.28;
/** 页边距 */
const MARGIN = 56;
/** 正文可用宽度 */
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

/** 字号（点） */
const FONT_SIZE_TITLE = 19;
const FONT_SIZE_SUBTITLE = 9;
const FONT_SIZE_H1 = 15;
const FONT_SIZE_H2 = 13;
const FONT_SIZE_H3 = 11.5;
const FONT_SIZE_BODY = 10.5;
/** 引文相对正文字号比例（替代上标） */
const CITE_SCALE = 0.72;

/** 行距（点） */
const LINE_GAP = 3;
/** 表格单元格内边距（点） */
const CELL_PADDING = 4;

/** 配色（与前端 MarkdownView / Word 导出一致） */
const COLOR_TEXT = '#172d31';
const COLOR_MUTED = '#687b80';
const COLOR_CITE = '#2563eb';
const COLOR_LINE = '#dce4e6';
const COLOR_THEAD_BG = '#f2f6f7';

/** 注册到 PDF 文档的字体别名 */
const FONT_REGULAR = 'cjk';

/** 模块日志（记录实际使用的字体与产物体积，便于生产排查中文渲染问题） */
const logger = new Logger('PdfBuilder');

/** 绘制用文本段（把行内节点归一为可连续绘制的片段） */
interface DrawRun {
  text: string;
  bold: boolean;
  cite: boolean;
}

/** 行内节点 → 绘制文本段（引文加方括号） */
function toRuns(inlines: Inline[]): DrawRun[] {
  return inlines.map((x) =>
    x.kind === 'citation'
      ? { text: `[${x.n}]`, bold: false, cite: true }
      : { text: x.text, bold: x.kind === 'bold', cite: false },
  );
}

/**
 * 注册中文字体：依次尝试候选（配置字体 → 平台兜底字体），
 * 任一成功即返回；全部失败抛业务异常（不静默输出乱码）。
 *
 * pdfkit 的注册是**惰性**的——`registerFont` 不读文件，直到真正选用才加载。
 * 因此这里注册后立即 `font()` 触发加载，让「字体集合内无该 PostScript 名」
 * 这类错误在此暴露，从而正确降级到下一个候选。
 *
 * @param doc PDF 文档实例
 * @param candidates 候选字体列表
 * @throws BizException 无可用中文字体
 */
function registerCjkFont(doc: PDFKit.PDFDocument, candidates: PdfFontCandidate[]): PdfFontCandidate {
  for (const c of candidates) {
    try {
      doc.registerFont(FONT_REGULAR, c.path, c.postscriptName);
      doc.font(FONT_REGULAR);
      return c;
    } catch {
      // 该候选不可用（无对应 PostScript 名 / 文件损坏），继续尝试下一个
    }
  }
  throw new BizException(
    ErrorCode.INTERNAL_ERROR,
    '服务器未找到可用中文字体，无法导出 PDF，请配置环境变量 PDF_FONT_PATH 指向中文字体文件',
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}

/**
 * 绘制一组行内节点为一个段落（引文用主题色小字号）。
 * 通过 pdfkit 的 continued 机制在同一行内切换样式，末段结束段落。
 */
function drawInlines(doc: PDFKit.PDFDocument, inlines: Inline[], fontSize: number): void {
  const runs = toRuns(inlines).filter((r) => r.text.length > 0);
  if (!runs.length) return;
  runs.forEach((run, i) => {
    const isLast = i === runs.length - 1;
    if (run.cite) {
      doc.fontSize(fontSize * CITE_SCALE).fillColor(COLOR_CITE);
    } else {
      doc.fontSize(fontSize).fillColor(COLOR_TEXT);
    }
    doc.text(run.text, { continued: !isLast, lineGap: LINE_GAP });
  });
  doc.fillColor(COLOR_TEXT).fontSize(fontSize);
}

/** 表格块类型别名 */
type TableBlock = Extract<MarkdownBlock, { type: 'table' }>;

/**
 * 绘制表格：逐行手工定位（用于画边框与底色），行高不足时自动分页。
 * 已知限制：表格跨页后不重复表头（本轮报告表格通常较短，未做处理）。
 * 说明：pdfkit 的 `doc.y` / `doc.x` 支持写入，故此处手工推进光标（已实测生效）。
 */
function drawTable(doc: PDFKit.PDFDocument, block: TableBlock): void {
  const colCount = block.head.length || 1;
  const colWidth = CONTENT_WIDTH / colCount;
  const pad = CELL_PADDING;
  const fontSize = FONT_SIZE_BODY - 0.5;

  const rows: Array<{ cells: Inline[][]; head: boolean }> = [
    { cells: block.head, head: true },
    ...block.rows.map((cells) => ({ cells, head: false })),
  ];

  const bottomLimit = doc.page.height - MARGIN;

  for (const row of rows) {
    const texts = row.cells.map((cell) => cell.map((x) => (x.kind === 'citation' ? `[${x.n}]` : x.text)).join(''));
    doc.fontSize(fontSize);
    const maxTextHeight = texts.reduce(
      (acc, t) => Math.max(acc, doc.heightOfString(t || ' ', { width: colWidth - pad * 2 })),
      fontSize,
    );
    const rowHeight = maxTextHeight + pad * 2;

    if (doc.y + rowHeight > bottomLimit) doc.addPage();

    const y = doc.y;
    const x0 = MARGIN;

    if (row.head) {
      doc.save().rect(x0, y, colWidth * colCount, rowHeight).fill(COLOR_THEAD_BG).restore();
    }

    row.cells.forEach((cell, i) => {
      const x = x0 + i * colWidth;
      doc
        .save()
        .lineWidth(0.5)
        .strokeColor(COLOR_LINE)
        .rect(x, y, colWidth, rowHeight)
        .stroke()
        .restore();
      const text = cell.map((c) => (c.kind === 'citation' ? `[${c.n}]` : c.text)).join('');
      doc
        .fontSize(fontSize)
        .fillColor(COLOR_TEXT)
        .text(text || ' ', x + pad, y + pad, { width: colWidth - pad * 2, height: rowHeight - pad * 2 });
    });

    // 手工推进光标到本行下方（表格需逐行定位，不能依赖文本流）
    doc.y = y + rowHeight;
    doc.x = MARGIN;
  }

  doc.moveDown(0.6);
}

/** 绘制 Markdown 块级结构 */
function drawBlocks(doc: PDFKit.PDFDocument, blocks: MarkdownBlock[]): void {
  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        const size =
          block.level === 1 ? FONT_SIZE_H1 : block.level === 2 ? FONT_SIZE_H2 : FONT_SIZE_H3;
        doc.moveDown(block.level === 1 ? 0.9 : 0.55);
        drawInlines(doc, block.inlines, size);
        doc.moveDown(0.3);
        break;
      }
      case 'paragraph': {
        drawInlines(doc, block.inlines, FONT_SIZE_BODY);
        doc.moveDown(0.45);
        break;
      }
      case 'list': {
        for (const item of block.items) {
          // 项目符号作为首个行内节点，保证引文着色逻辑一致
          drawInlines(doc, [{ kind: 'text', text: '•  ' }, ...item], FONT_SIZE_BODY);
          doc.moveDown(0.18);
        }
        doc.moveDown(0.3);
        break;
      }
      case 'table': {
        drawTable(doc, block);
        break;
      }
    }
  }
}

/** 绘制文末「参考来源」清单（按 idx 升序） */
function drawSources(doc: PDFKit.PDFDocument, sources: ExportSource[]): void {
  if (!sources.length) return;
  doc.moveDown(0.9);
  doc.fontSize(FONT_SIZE_H2).fillColor(COLOR_TEXT).text('参考来源');
  doc.moveDown(0.4);
  const sorted = [...sources].sort((a, b) => a.idx - b.idx);
  for (const s of sorted) {
    const head = `${s.idx}. ${s.name}`;
    doc.fontSize(FONT_SIZE_BODY - 0.5).fillColor(COLOR_TEXT).text(head, { lineGap: 1 });
    if (s.url) {
      doc.fontSize(FONT_SIZE_BODY - 1.5).fillColor(COLOR_MUTED).text(s.url, { lineGap: 1 });
    }
    if (s.desc) {
      doc.fontSize(FONT_SIZE_BODY - 1.5).fillColor(COLOR_MUTED).text(s.desc, { lineGap: 1 });
    }
    doc.moveDown(0.25);
  }
}

/**
 * 报告 → .pdf Buffer。
 * @param report 统一导出输入（标题 / 副标题 / Markdown 正文 / 来源清单）
 * @param fontPath 环境变量 PDF_FONT_PATH 的值（可选，生产建议显式指定）
 * @returns PDF 文件二进制
 * @throws BizException 未找到可用中文字体
 */
export async function buildPdf(report: ExportReport, fontPath?: string): Promise<Buffer> {
  const candidates = resolveCjkFonts(fontPath);
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    info: { Title: report.title, Author: 'AI数智研究平台' },
  });
  const usedFont = registerCjkFont(doc, candidates);

  const chunks: Buffer[] = [];
  const collected = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.fontSize(FONT_SIZE_TITLE).fillColor(COLOR_TEXT).text(report.title, { lineGap: 2 });
  if (report.subtitle) {
    doc.moveDown(0.3);
    doc.fontSize(FONT_SIZE_SUBTITLE).fillColor(COLOR_MUTED).text(report.subtitle);
  }
  doc.moveDown(0.7);

  drawBlocks(doc, parseMarkdown(report.contentMd));
  drawSources(doc, report.sources);

  doc.end();
  const buffer = await collected;
  logger.log(`PDF 导出完成：字体=${usedFont.path} bytes=${buffer.byteLength}`);
  return buffer;
}
