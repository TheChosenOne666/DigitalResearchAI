import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  DocParserService,
  detectMimeType,
} from '../src/modules/kb/parse/doc-parser.service';

const svc = new DocParserService();

describe('detectMimeType 扩展名推断', () => {
  it.each([
    ['a.xlsx', 'xlsx'],
    ['a.XLSX', 'xlsx'],
    ['a.xls', 'xlsx'],
    ['a.csv', 'csv'],
    ['a.docx', 'docx'],
    ['a.doc', 'docx'],
    ['a.pdf', 'pdf'],
    ['a.txt', 'txt'],
    ['a.md', 'md'],
    ['no-ext', 'txt'],
  ])('%s → %s', (file, expected) => {
    expect(detectMimeType(file)).toBe(expected);
  });
});

describe('DocParserService.parse 文本类', () => {
  it('txt/md 原样返回 utf8', async () => {
    const buf = Buffer.from('# 标题\n\n正文内容', 'utf8');
    await expect(svc.parse('md', buf)).resolves.toBe('# 标题\n\n正文内容');
    await expect(svc.parse('txt', buf)).resolves.toContain('正文');
  });

  it('csv 过滤空行保留行序', async () => {
    const csv = 'name,score\n张三,90\n\n\n李四,85\n';
    const out = await svc.parse('csv', Buffer.from(csv, 'utf8'));
    expect(out).toBe('name,score\n张三,90\n李四,85');
  });

  it('不支持的类型抛业务异常', async () => {
    await expect(svc.parse('exe' as any, Buffer.from('MZ'))).rejects.toThrow(
      /不支持的文件类型/,
    );
  });
});

describe('DocParserService.parse Excel', () => {
  it('多 sheet 解析为表格文本（含表头与单元格）', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['年份', 'GDP'],
        ['2024', '100'],
      ]),
      '宏观',
    );
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const out = await svc.parse('xlsx', buf);
    expect(out).toContain('## Sheet: 宏观');
    expect(out).toContain('年份\tGDP');
    expect(out).toContain('2024\t100');
  });

  it('损坏的 Word 字节抛解析失败（供上层置 FAILED）', async () => {
    await expect(svc.parse('docx', Buffer.from('not-a-word'))).rejects.toThrow(
      /Word 解析失败/,
    );
  });
});
