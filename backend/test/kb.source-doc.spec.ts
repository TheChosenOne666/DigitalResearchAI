import { describe, it, expect } from 'vitest';
import {
  buildSourceDocument,
  sanitizeSourceName,
} from '../src/modules/kb/save/source-doc';

describe('sanitizeSourceName 来源标题清洗', () => {
  it('剔除路径与非法字符、压缩空白', () => {
    expect(sanitizeSourceName('  a/b\\c:d*e?f"g<h>i|j  ')).toBe('a b c d e f g h i j');
    expect(sanitizeSourceName('中美\tGDP\n对比')).toBe('中美 GDP 对比');
  });

  it('空标题回退「智搜来源」', () => {
    expect(sanitizeSourceName('')).toBe('智搜来源');
    expect(sanitizeSourceName('///')).toBe('智搜来源');
  });

  it('超长标题截断到 80 字符', () => {
    const long = '标'.repeat(120);
    expect(sanitizeSourceName(long)).toHaveLength(80);
  });
});

describe('buildSourceDocument 来源→Markdown 文档', () => {
  it('组合标题/元信息/摘要，链接与问题可选出现', () => {
    const doc = buildSourceDocument(
      { idx: 0, title: '世界银行：美国 GDP', url: 'https://data.worldbank.org', snippet: '  美国 GDP 数据… ', sourceType: 'web' },
      { sessionId: 's1', question: '美国 GDP 如何？', savedAt: new Date('2026-08-27T00:00:00Z') },
    );
    expect(doc.name).toBe('世界银行：美国 GDP.md');
    expect(doc.content).toContain('# 世界银行：美国 GDP');
    expect(doc.content).toContain('[原文链接](https://data.worldbank.org)');
    expect(doc.content).toContain('> 检索任务会话：s1');
    expect(doc.content).toContain('> 检索问题：美国 GDP 如何？');
    expect(doc.content).toContain('美国 GDP 数据…');
    expect(doc.content.endsWith('美国 GDP 数据…\n')).toBe(true);
  });

  it('无 url 不渲染链接行，空摘要回退占位', () => {
    const doc = buildSourceDocument(
      { idx: 1, title: '垂直数据', url: null, snippet: '', sourceType: 'vertical' },
      { sessionId: 's2', savedAt: new Date('2026-08-27T00:00:00Z') },
    );
    expect(doc.content).not.toContain('原文链接');
    expect(doc.content).toContain('> 检索任务会话：s2');
    expect(doc.content).not.toContain('检索问题');
    expect(doc.content).toContain('（来源无摘要内容）');
  });

  it('来源类型映射中文标签，未知类型原样输出', () => {
    const mk = (t: string) =>
      buildSourceDocument({ idx: 0, title: 'x', url: null, snippet: 's', sourceType: t }, { sessionId: 's' }).content;
    expect(mk('web')).toContain('> 来源：联网');
    expect(mk('vertical')).toContain('> 来源：垂直数据');
    expect(mk('local')).toContain('> 来源：本地知识库');
    expect(mk('other')).toContain('> 来源：other');
  });
});
