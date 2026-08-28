/** 智搜来源存入知识库的入参（单条来源） */
export interface SourceDocInput {
  idx: number;
  title: string;
  url: string | null;
  snippet: string;
  sourceType: string;
}

/** 来源文档生成上下文 */
export interface SourceDocContext {
  /** 所属检索会话 id */
  sessionId: string;
  /** 检索问题（可空，历史报告可能未带） */
  question?: string | null;
  /** 存入时间 */
  savedAt?: Date;
}

/** 来源类型 → 中文标签（存入文档元信息用） */
const SOURCE_TYPE_LABELS: Record<string, string> = {
  web: '联网',
  vertical: '垂直数据',
  local: '本地知识库',
};

/** 文档名最大长度（防超长标题撑爆 VarChar(255)） */
const MAX_NAME_LEN = 80;

/**
 * 清洗来源标题为安全文件名：剔除路径/非法字符与控制符，
 * 压缩空白，超长截断。空标题回退「智搜来源」。
 */
export function sanitizeSourceName(title: string): string {
  const cleaned = title
    // eslint-disable-next-line no-control-regex -- 有意剔除文件名中的控制字符（\x00-\x1f）
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '智搜来源';
  return cleaned.length > MAX_NAME_LEN ? cleaned.slice(0, MAX_NAME_LEN) : cleaned;
}

/**
 * 将一条智搜来源组合为 Markdown 文本（纯函数）：
 * 标题作一级标题，元信息（类型/链接/会话/时间）放引用块，正文为来源摘要。
 * 存入时整体以 UTF-8 落 fileData（mimeType=md），复用 M3.2 学习管道解析切片。
 */
export function buildSourceDocument(
  src: SourceDocInput,
  ctx: SourceDocContext,
): { name: string; content: string } {
  const name = `${sanitizeSourceName(src.title)}.md`;
  const typeLabel = SOURCE_TYPE_LABELS[src.sourceType] ?? src.sourceType;
  const savedAt = (ctx.savedAt ?? new Date()).toISOString();
  const lines = [
    `# ${src.title}`,
    '',
    `> 来源：${typeLabel}${src.url ? ` · [原文链接](${src.url})` : ''}`,
    `> 检索任务会话：${ctx.sessionId}`,
    ctx.question ? `> 检索问题：${ctx.question}` : null,
    `> 存入时间：${savedAt}`,
    '',
    '## 内容摘要',
    '',
    src.snippet.trim() || '（来源无摘要内容）',
    '',
  ].filter((l): l is string => l !== null);
  return { name, content: lines.join('\n') };
}
