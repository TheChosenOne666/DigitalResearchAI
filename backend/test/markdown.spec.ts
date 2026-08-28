import { describe, it, expect } from 'vitest';
import { parseInline, inlineToText, parseMarkdown } from '../src/modules/report/export/markdown';

describe('report/export/markdown.parseInline', () => {
  it('普通文本', () => {
    expect(parseInline('GDP 增长率上升')).toEqual([{ kind: 'text', text: 'GDP 增长率上升' }]);
  });

  it('**加粗** 与普通文本混排', () => {
    const out = parseInline('前文**核心结论**后文');
    expect(out).toEqual([
      { kind: 'text', text: '前文' },
      { kind: 'bold', text: '核心结论' },
      { kind: 'text', text: '后文' },
    ]);
  });

  it('{c:N} 引文标记拆分为 citation 节点', () => {
    const out = parseInline('据世界银行数据{c:1}与统报{c:12}显示');
    expect(out).toEqual([
      { kind: 'text', text: '据世界银行数据' },
      { kind: 'citation', n: 1 },
      { kind: 'text', text: '与统报' },
      { kind: 'citation', n: 12 },
      { kind: 'text', text: '显示' },
    ]);
  });

  it('加粗内含引文（引文最后处理，不破坏加粗边界）', () => {
    const out = parseInline('**增速回落{c:3}**');
    expect(out).toEqual([
      { kind: 'bold', text: '增速回落{c:3}' },
    ]);
  });

  it('inlineToText：引文转 [N]，加粗保留文字', () => {
    const inlines = parseInline('结论**明显**{c:2}');
    expect(inlineToText(inlines)).toBe('结论明显[2]');
  });
});

describe('report/export/markdown.parseMarkdown', () => {
  it('标题层级（# / ## / ###）', () => {
    const blocks = parseMarkdown('# 一级\n## 二级\n### 三级');
    expect(blocks).toEqual([
      { type: 'heading', level: 1, inlines: [{ kind: 'text', text: '一级' }] },
      { type: 'heading', level: 2, inlines: [{ kind: 'text', text: '二级' }] },
      { type: 'heading', level: 3, inlines: [{ kind: 'text', text: '三级' }] },
    ]);
  });

  it('连续非特殊行合并为一段', () => {
    const blocks = parseMarkdown('第一行\n第二行\n\n另一段');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: 'paragraph', inlines: [{ kind: 'text', text: '第一行 第二行' }] });
    expect(blocks[1]).toEqual({ type: 'paragraph', inlines: [{ kind: 'text', text: '另一段' }] });
  });

  it('无序列表（- 与 * 混合并收集连续项）', () => {
    const blocks = parseMarkdown('- 项目一\n* 项目二\n- 项目三');
    expect(blocks).toHaveLength(1);
    const b = blocks[0];
    expect(b.type).toBe('list');
    if (b.type === 'list') {
      expect(inlineToText(b.items[0])).toBe('项目一');
      expect(inlineToText(b.items[1])).toBe('项目二');
      expect(b.items).toHaveLength(3);
    }
  });

  it('多列表格（表头 + 分隔行 + 数据行）', () => {
    const md = '| 国家 | 2023 | 2024 |\n| --- | --- | --- |\n| 中国 | 5.2 | 4.9 |\n| 美国 | 2.5 | 2.8 |';
    const blocks = parseMarkdown(md);
    expect(blocks).toHaveLength(1);
    const b = blocks[0];
    expect(b.type).toBe('table');
    if (b.type === 'table') {
      expect(b.head.map(inlineToText)).toEqual(['国家', '2023', '2024']);
      expect(b.rows).toHaveLength(2);
      expect(b.rows[0].map(inlineToText)).toEqual(['中国', '5.2', '4.9']);
    }
  });

  it('引用（>）降级为段落，不崩溃', () => {
    const blocks = parseMarkdown('> 引用内容');
    expect(blocks).toEqual([{ type: 'paragraph', inlines: [{ kind: 'text', text: '引用内容' }] }]);
  });

  it('未识别结构降级为段落（不丢内容）', () => {
    const blocks = parseMarkdown('1. 有序列表项');
    expect(blocks).toEqual([{ type: 'paragraph', inlines: [{ kind: 'text', text: '1. 有序列表项' }] }]);
  });

  it('空字符串返回空数组', () => {
    expect(parseMarkdown('')).toEqual([]);
  });
});
