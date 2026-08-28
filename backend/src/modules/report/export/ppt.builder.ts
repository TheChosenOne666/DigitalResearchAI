/**
 * 报告导出 · PPT（.pptx）构建器。
 *
 * 精简结构：封面 → 摘要（正文要点）→ 数据分析表 → 参考来源。
 * 图表嵌入已确认本期不做（D2），「图表页」以数据分析表呈现。
 * 正文仅取纯文本（inlineToText），引文转 [N]。
 */

import PptxGenJS from 'pptxgenjs';
import {
  parseMarkdown,
  inlineToText,
  type MarkdownBlock,
} from './markdown';
import type { ExportReport } from './word.builder';

/** 标题色（深蓝，对齐前端主题 #2563EB） */
const PRIMARY = '2563EB';
const MUTED = '64748B';
const DARK = '0F172A';

/** 从 blocks 提取纯文本要点（段落 + 列表项），限制条数 */
function extractPoints(blocks: MarkdownBlock[], max: number): string[] {
  const points: string[] = [];
  for (const b of blocks) {
    if (points.length >= max) break;
    if (b.type === 'paragraph') {
      const t = inlineToText(b.inlines).trim();
      if (t) points.push(t);
    } else if (b.type === 'list') {
      for (const item of b.items) {
        if (points.length >= max) break;
        const t = inlineToText(item).trim();
        if (t) points.push(`· ${t}`);
      }
    }
  }
  return points;
}

/**
 * 报告 → .pptx Buffer。
 * @param report 统一导出输入（标题/正文/来源）
 */
export async function buildPpt(report: ExportReport): Promise<Buffer> {
  const blocks = parseMarkdown(report.contentMd);
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'AI数智研究平台';
  pptx.title = report.title;

  // 1. 封面
  const cover = pptx.addSlide();
  cover.background = { color: 'F8FAFC' };
  cover.addText(report.title, {
    x: 0.8, y: 2.4, w: 11.7, h: 1.4,
    fontSize: 30, bold: true, color: PRIMARY, align: 'center', valign: 'middle',
  });
  if (report.subtitle) {
    cover.addText(report.subtitle, {
      x: 0.8, y: 3.9, w: 11.7, h: 0.5,
      fontSize: 14, color: MUTED, align: 'center',
    });
  }

  // 2. 摘要（正文要点，按页分块）
  const points = extractPoints(blocks, 24);
  if (points.length) {
    const chunks: string[][] = [];
    for (let i = 0; i < points.length; i += 6) chunks.push(points.slice(i, i + 6));
    chunks.forEach((chunk, ci) => {
      const s = pptx.addSlide();
      s.addText(ci === 0 ? '报告摘要' : `报告摘要（续 ${ci + 1}）`, {
        x: 0.6, y: 0.4, w: 6, h: 0.6, fontSize: 22, bold: true, color: DARK,
      });
      s.addText(chunk.map((p) => ({ text: p, options: { bullet: false, breakLine: true } })), {
        x: 0.6, y: 1.2, w: 12.1, h: 5.6, fontSize: 14, color: DARK, valign: 'top', lineSpacingMultiple: 1.3,
      });
    });
  }

  // 3. 数据分析表（取第一个表格）
  const tableBlock = blocks.find((b) => b.type === 'table');
  if (tableBlock && tableBlock.type === 'table') {
    const s = pptx.addSlide();
    s.addText('数据分析表', { x: 0.6, y: 0.4, w: 6, h: 0.6, fontSize: 22, bold: true, color: DARK });
    const head = tableBlock.head.map((c) => inlineToText(c));
    const body = tableBlock.rows.map((r) => r.map((c) => inlineToText(c)));
    const rows: PptxGenJS.TableCell[][] = [head, ...body].map((r) => r.map((text) => ({ text })));
    s.addTable(rows, {
      x: 0.6, y: 1.2, w: 12.1, h: 5.6,
      fontSize: 11, color: DARK, border: { type: 'solid', pt: 0.5, color: 'D9E2EC' },
      fill: { color: 'FFFFFF' },
      colW: Array.from({ length: head.length }, () => 12.1 / Math.max(head.length, 1)),
      autoPage: false,
    });
  }

  // 4. 参考来源
  const sources = [...report.sources].sort((a, b) => a.idx - b.idx);
  const srcSlide = pptx.addSlide();
  srcSlide.addText(`参考来源（${sources.length}）`, {
    x: 0.6, y: 0.4, w: 6, h: 0.6, fontSize: 22, bold: true, color: DARK,
  });
  const srcText = sources.length
    ? sources.map((s) => ({
        text: `[${s.idx}] ${s.name}${s.url ? `  ${s.url}` : ''}${s.desc ? `  ${s.desc}` : ''}`,
        options: { bullet: false, breakLine: true },
      }))
    : [{ text: '未勾选外部来源。', options: { bullet: false } }];
  srcSlide.addText(srcText, {
    x: 0.6, y: 1.2, w: 12.1, h: 5.6, fontSize: 12, color: MUTED, valign: 'top', lineSpacingMultiple: 1.3,
  });

  return pptx.write({ outputType: 'nodebuffer' }) as Promise<Buffer>;
}
