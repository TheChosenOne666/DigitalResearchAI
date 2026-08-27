import { describe, it, expect } from 'vitest';
import { chunkText } from '../src/modules/kb/chunk/chunker';

describe('chunkText FIXED 固定长度', () => {
  it('短文本单切片', () => {
    const out = chunkText('只有一句话', { mode: 'FIXED', size: 100, overlap: 10 });
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ index: 0, content: '只有一句话' });
  });

  it('长文本按 size 切、overlap 衔接', () => {
    const text = 'x'.repeat(250);
    const out = chunkText(text, { mode: 'FIXED', size: 100, overlap: 20 });
    // step = 80 → 0..100, 80..180, 160..250
    expect(out.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(out[1].content.length).toBe(100);
    // 相邻切片有 overlap 字符重叠
    const tail = out[0].content.slice(-20);
    expect(out[1].content.startsWith(tail)).toBe(true);
    // 拼接后覆盖全文末尾
    expect(out[2].content.endsWith('x'.repeat(10))).toBe(true);
  });

  it('overlap ≥ size 时被钳制不产生死循环', () => {
    const out = chunkText('y'.repeat(50), { mode: 'FIXED', size: 20, overlap: 99 });
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) {
      expect(c.content.length).toBeLessThanOrEqual(20);
    }
  });

  it('空文本返回空数组', () => {
    expect(chunkText('', { mode: 'FIXED' })).toEqual([]);
    expect(chunkText('   \n  ', { mode: 'FIXED' })).toEqual([]);
  });
});

describe('chunkText SMART 智能分段', () => {
  it('标题行独立成片，段落不被切碎', () => {
    const para = 'A'.repeat(60);
    const text = `第一章 概述\n\n${para}\n\n${para.replace(/A/g, 'B')}`;
    const out = chunkText(text, { mode: 'SMART', size: 200, overlap: 20 });
    expect(out[0].content).toBe('第一章 概述');
    expect(out).toHaveLength(3);
  });

  it('超长段落按 size 截断且优先换行边界', () => {
    const line = 'w'.repeat(80);
    const block = Array(10).fill(line).join('\n'); // 890 字符
    const out = chunkText(block, { mode: 'SMART', size: 200, overlap: 40 });
    expect(out.length).toBeGreaterThanOrEqual(4);
    for (const c of out) {
      expect(c.content.length).toBeLessThanOrEqual(200);
    }
    // 首片在换行边界截断（80 处的 \n 位于 size/2 之后）
    expect(out[0].content.endsWith(line)).toBe(true);
  });

  it('index 连续递增', () => {
    const text = Array.from({ length: 30 }, (_, i) => `段${i} ${'c'.repeat(50)}`).join('\n\n');
    const out = chunkText(text, { mode: 'SMART', size: 120, overlap: 20 });
    expect(out.map((c) => c.index)).toEqual(out.map((_, i) => i));
  });
});
