/**
 * 报告导出 · 轻量 Markdown 块级解析器（纯函数，便于单测）。
 *
 * 仅覆盖报告正文用到的固定结构（对齐 M2/M4 生成约定）：
 * 标题（# / ## / ###）、段落、无序列表（- / *）、表格（| ... |）、
 * 引用（>，降级为段落）；行内支持 **加粗** 与 {c:N} 引文标记。
 * 未识别的结构一律降级为段落，保证不崩溃、不丢内容。
 */

/** 行内节点 */
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'citation'; n: number };

/** 块级节点 */
export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; inlines: Inline[] }
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'list'; items: Inline[][] }
  | { type: 'table'; head: Inline[][]; rows: Inline[][][] };

/** 引文标记 {c:N}（与 generate.service 的 CITATION_PATTERN / MarkdownView 对齐） */
const CITATION_RE = /\{c:(\d+)\}/g;

/** 解析行内：先拆 **加粗**，再处理 {c:N} 引文（引文最后，避免被其它规则破坏） */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  // 按 **bold** 切分（非贪婪）
  const parts = text.split(/\*\*([^*]+)\*\*/g);
  parts.forEach((part, i) => {
    if (!part) return;
    if (i % 2 === 1) {
      out.push({ kind: 'bold', text: part });
      return;
    }
    // 普通文本段，进一步拆 {c:N}
    let last = 0;
    let m: RegExpExecArray | null;
    CITATION_RE.lastIndex = 0;
    while ((m = CITATION_RE.exec(part)) !== null) {
      if (m.index > last) out.push({ kind: 'text', text: part.slice(last, m.index) });
      out.push({ kind: 'citation', n: Number(m[1]) });
      last = m.index + m[0].length;
    }
    if (last < part.length) out.push({ kind: 'text', text: part.slice(last) });
  });
  // 去掉首尾空文本节点
  return out.filter((x) => x.kind !== 'text' || x.text.length > 0);
}

/** 行内 → 纯文本（PPT/来源表等纯文本场景用），引文转 [N] */
export function inlineToText(inlines: Inline[]): string {
  return inlines
    .map((x) => {
      if (x.kind === 'text' || x.kind === 'bold') return x.text;
      return `[${x.n}]`;
    })
    .join('');
}

/** 判断是否为表格分隔行（如 |---|:---:|---|） */
function isTableSeparator(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith('|') || !t.endsWith('|')) return false;
  const cells = t
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim());
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c));
}

/** 解析表格单元格内容为行内 */
function parseRowCells(line: string): Inline[][] {
  const t = line.trim();
  if (!t.startsWith('|')) return [];
  let body = t;
  if (body.endsWith('|')) body = body.slice(0, -1);
  body = body.replace(/^\|/, '');
  return body.split('|').map((c) => parseInline(c.trim()));
}

/**
 * 解析 Markdown 为块级结构。
 * @param md 报告正文（Markdown）
 */
export function parseMarkdown(md: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 空行：段落/列表分隔
    if (!trimmed) {
      i++;
      continue;
    }

    // 标题
    const h = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (h) {
      blocks.push({
        type: 'heading',
        level: h[1].length as 1 | 2 | 3,
        inlines: parseInline(h[2]),
      });
      i++;
      continue;
    }

    // 无序列表（连续 - / * 行）
    if (/^[-*]\s+/.test(trimmed)) {
      const items: Inline[][] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(parseInline(lines[i].trim().replace(/^[-*]\s+/, '')));
        i++;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    // 表格：表头行 + 分隔行 + 若干数据行
    if (trimmed.startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const head = parseRowCells(trimmed);
      const rows: Inline[][][] = [];
      i += 2; // 跳过表头 + 分隔行
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(parseRowCells(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', head, rows });
      continue;
    }

    // 引用（>）降级为段落
    if (trimmed.startsWith('>')) {
      blocks.push({ type: 'paragraph', inlines: parseInline(trimmed.replace(/^>\s*/, '')) });
      i++;
      continue;
    }

    // 普通段落（连续非空、非特殊行合并为一段）
    const buf: string[] = [trimmed];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3})\s+/.test(lines[i].trim()) &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith('|') &&
      !lines[i].trim().startsWith('>')
    ) {
      buf.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: 'paragraph', inlines: parseInline(buf.join(' ')) });
  }

  return blocks;
}
