<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';

/**
 * 轻量 Markdown 渲染组件（M2.4）：
 * - 支持 AI 分析报告常用块级语法：标题、段落、列表、表格、引用、分隔线、行内代码、粗体/斜体。
 * - 支持 `{c:N}` 引文标记 → 渲染为可点击角标（emit cite-click 与来源卡联动）。
 * - activeCite 传入时将对应角标高亮（黄色徽标）。
 */
const props = defineProps<{
  content: string;
  activeCite?: number | null;
}>();

const emit = defineEmits<{ citeClick: [idx: number] }>();

const container = ref<HTMLElement | null>(null);
const html = ref('');

/** HTML 转义（防止 AI 输出注入） */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 行内：粗体/斜体/行内代码/引文角标（引文最后替换，避免被其它规则破坏） */
function renderInline(s: string): string {
  let out = s
    .replace(/`([^`]+)`/g, (_, c: string) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?![^*])/g, '$1<em>$2</em>');
  out = out.replace(
    /\{c:(\d+)\}/g,
    (_, n: string) => `<sup class="cite" data-idx="${Number(n)}">[${Number(n)}]</sup>`,
  );
  return out;
}

/** 按 `|` 拆表格行（去首尾空列） */
function splitRow(line: string): string[] {
  const parts = line.split('|').map((s) => s.trim());
  if (parts[0] === '') parts.shift();
  if (parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/** 是否为列表项行 */
const LIST_RE = /^([-*+]|\d+\.)\s+/;
/** 是否为表格行 */
const TABLE_RE = /^\s*\|/;

/** 渲染（多级）列表，返回结束后行号 */
function renderList(lines: string[], start: number, out: string[]): number {
  const tag = /^\d+\./.test(lines[start].trim()) ? 'ol' : 'ul';
  let html = `<${tag}>`;
  let i = start;
  const baseIndent = (lines[start].match(/^ */) ?? [''])[0].length;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) break;
    const m = line.trim().match(LIST_RE);
    if (!m) break;
    const ind = (line.match(/^ */) ?? [''])[0].length;
    if (ind < baseIndent) break;
    const content = line.trim().replace(LIST_RE, '');
    html += `<li>${renderInline(escapeHtml(content))}`;
    // 嵌套列表（下一行更深缩进且仍是列表项）
    if (i + 1 < lines.length) {
      const nl = lines[i + 1];
      if (/^\s+([-*+]|\d+\.)\s+/.test(nl) && (nl.match(/^ */) ?? [''])[0].length > baseIndent) {
        const tag2 = /^\d+\./.test(nl.trim()) ? 'ol' : 'ul';
        html += `<${tag2}>`;
        let j = i + 1;
        while (
          j < lines.length &&
          (lines[j].match(/^ */) ?? [''])[0].length > baseIndent &&
          !!(lines[j].trim().match(LIST_RE))
        ) {
          const sm = lines[j].trim().match(LIST_RE)!;
          html += `<li>${renderInline(escapeHtml(lines[j].trim().slice(sm[0].length)))}</li>`;
          j++;
        }
        html += `</${tag2}>`;
        i = j;
        html += '</li>';
        continue;
      }
    }
    html += '</li>';
    i++;
  }
  html += `</${tag}>`;
  out.push(html);
  return i;
}

/** 全文 Markdown → HTML */
function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) {
      i++;
      continue;
    }
    // 代码块
    if (t.startsWith('```')) {
      i++;
      const code: string[] = [];
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code.push(lines[i]);
        i++;
      }
      i++;
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    // 标题
    const h = t.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      out.push(`<h${lvl}>${renderInline(escapeHtml(h[2]))}</h${lvl}>`);
      i++;
      continue;
    }
    // 分隔线
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      out.push('<hr>');
      i++;
      continue;
    }
    // 引用
    if (t.startsWith('>')) {
      const q: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        q.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderInline(escapeHtml(q.join('\n')))}</blockquote>`);
      continue;
    }
    // 表格：当前行是表头且下一行是分隔行
    if (TABLE_RE.test(t)) {
      const sep = lines[i + 1]?.trim() ?? '';
      if (/^\|?[\s:-]+\|?\s*$/.test(sep) && sep.includes('-')) {
        const header = splitRow(t);
        i += 2;
        const rows: string[][] = [];
        while (i < lines.length && TABLE_RE.test(lines[i])) {
          rows.push(splitRow(lines[i].trim()));
          i++;
        }
        let th = '<table><thead><tr>';
        th += header.map((c) => `<th>${renderInline(escapeHtml(c))}</th>`).join('');
        th += '</tr></thead><tbody>';
        for (const r of rows) {
          th += '<tr>' + r.map((c) => `<td>${renderInline(escapeHtml(c))}</td>`).join('') + '</tr>';
        }
        th += '</tbody></table>';
        out.push(th);
        continue;
      }
    }
    // 列表
    if (LIST_RE.test(t)) {
      i = renderList(lines, i, out);
      continue;
    }
    // 段落
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,3}\s|```|>\s?|(-{3,}|\*{3,}|_{3,})$)/.test(lines[i].trim()) &&
      !LIST_RE.test(lines[i].trim()) &&
      !TABLE_RE.test(lines[i].trim())
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${renderInline(escapeHtml(para.join(' ')))}</p>`);
  }
  return out.join('\n');
}

watch(
  () => props.content,
  (val) => {
    html.value = renderMarkdown(val);
  },
  { immediate: true },
);

/** 同步角标高亮（根据 activeCite 增删 .active） */
watch(
  () => props.activeCite,
  async () => {
    await nextTick();
    container.value
      ?.querySelectorAll<HTMLElement>('.cite')
      .forEach((el) => {
        const idx = Number(el.dataset.idx);
        if (props.activeCite != null && idx === props.activeCite) {
          el.classList.add('active');
        } else {
          el.classList.remove('active');
        }
      });
  },
  { immediate: true },
);

/** 点击角标 → 通知父组件联动来源卡 */
function onClick(e: MouseEvent): void {
  const target = (e.target as HTMLElement).closest('.cite') as HTMLElement | null;
  if (target?.dataset.idx) {
    emit('citeClick', Number(target.dataset.idx));
  }
}
</script>

<template>
  <div ref="container" class="md-view" @click="onClick" v-html="html" />
</template>

<style scoped>
.md-view {
  line-height: 1.75;
  color: #1e293b;
  font-size: 15px;
  word-break: break-word;
}
.md-view :deep(h1),
.md-view :deep(h2),
.md-view :deep(h3) {
  margin: 1.2em 0 0.6em;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.4;
}
.md-view :deep(h1) {
  font-size: 22px;
}
.md-view :deep(h2) {
  font-size: 19px;
}
.md-view :deep(h3) {
  font-size: 16px;
}
.md-view :deep(p) {
  margin: 0.6em 0;
}
.md-view :deep(ul),
.md-view :deep(ol) {
  margin: 0.5em 0;
  padding-left: 1.4em;
}
.md-view :deep(li) {
  margin: 0.3em 0;
}
.md-view :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0.8em 0;
  font-size: 13px;
}
.md-view :deep(th),
.md-view :deep(td) {
  border: 1px solid #e2e8f0;
  padding: 8px 10px;
  text-align: left;
}
.md-view :deep(th) {
  background: #f1f5f9;
  font-weight: 600;
  color: #334155;
}
.md-view :deep(blockquote) {
  margin: 0.8em 0;
  padding: 0.4em 1em;
  border-left: 3px solid #2563eb;
  background: #f8fafc;
  color: #475569;
}
.md-view :deep(code) {
  background: #f1f5f9;
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 0.9em;
  color: #b91c1c;
}
.md-view :deep(pre) {
  background: #0f172a;
  color: #e2e8f0;
  padding: 14px;
  border-radius: 8px;
  overflow-x: auto;
}
.md-view :deep(pre code) {
  background: transparent;
  color: inherit;
  padding: 0;
}
.md-view :deep(hr) {
  border: none;
  border-top: 1px solid #e2e8f0;
  margin: 1.4em 0;
}
.md-view :deep(.cite) {
  display: inline-block;
  margin: 0 2px;
  padding: 0 5px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.6;
  color: #2563eb;
  background: #e9effd;
  border: 1px solid #bdd0f9;
  cursor: pointer;
  vertical-align: super;
  user-select: none;
  transition:
    background 0.2s,
    color 0.2s;
}
.md-view :deep(.cite:hover) {
  background: #d3e0fb;
}
.md-view :deep(.cite.active) {
  background: #fde68a;
  color: #92400e;
  border-color: #fcd34d;
}
</style>