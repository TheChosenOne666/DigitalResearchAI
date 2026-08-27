/**
 * 知识库文档切片（M3.2）：把解析出的纯文本按配置切成若干片段。
 * 纯函数、无第三方依赖，便于单测。支持固定长度（FIXED）与智能分段（SMART）两种模式。
 */

/** 切片配置 */
export interface ChunkConfig {
  /** 分段方式：FIXED 固定长度 / SMART 智能分段（默认 FIXED） */
  mode?: 'FIXED' | 'SMART';
  /** 分段长度（字符数，默认 800） */
  size?: number;
  /** 重叠长度（字符数，默认 80） */
  overlap?: number;
}

/** 单切片 */
export interface Chunk {
  /** 切片序号（从 0 开始） */
  index: number;
  /** 切片内容 */
  content: string;
}

/** 根据换行把文本拆成"块"列表（块=空行分隔的段落组，或单行） */
function splitBlocks(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}

/** 固定长度切片：按 size 切，overlap 重叠衔接；尾部剩余若已全部落在上一片的覆盖范围内则不再成片 */
function chunkFixed(text: string, size: number, overlap: number): string[] {
  if (!text) return [];
  const step = Math.max(1, size - overlap);
  const out: string[] = [];
  for (let i = 0; i < text.length; i += step) {
    out.push(text.slice(i, i + size));
    if (i + size >= text.length) break;
  }
  return out;
}

/** 智能分段：优先按标题行(一行短文本)/段落边界断，超长段再按固定长度截断 */
function chunkSmart(text: string, size: number, overlap: number): string[] {
  const blocks = splitBlocks(text);
  const out: string[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer.trim()) out.push(buffer.trim());
    buffer = '';
  };
  for (const block of blocks) {
    // 单行且较短 → 视作标题/短段，独立成块
    if (block.length <= size && !block.includes('\n')) {
      flush();
      out.push(block);
      continue;
    }
    // 超长块：先并入缓冲，再按固定长度切
    buffer = (buffer ? buffer + '\n\n' : '') + block;
    while (buffer.length > size) {
      const cut = buffer.slice(0, size);
      const boundary = cut.lastIndexOf('\n');
      const splitAt = boundary > size / 2 ? boundary : size;
      out.push(cut.slice(0, splitAt).trim());
      buffer = buffer.slice(splitAt - overlap);
    }
  }
  flush();
  return out;
}

/**
 * 对纯文本做切片。
 * @param text 文档解析后的纯文本
 * @param opts 切片配置（mode/size/overlap）
 * @returns 切片数组（按 index 升序）
 */
export function chunkText(text: string, opts: ChunkConfig = {}): Chunk[] {
  const size = Math.max(1, opts.size ?? 800);
  const overlap = Math.min(size - 1, Math.max(0, opts.overlap ?? 80));
  const parts =
    opts.mode === 'SMART' ? chunkSmart(text, size, overlap) : chunkFixed(text, size, overlap);
  return parts.filter((p) => p.trim()).map((content, index) => ({ index, content }));
}