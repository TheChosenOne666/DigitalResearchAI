import { describe, it, expect } from 'vitest';
import { decodeUploadFilename } from '../src/modules/kb/kb.controller';

describe('decodeUploadFilename 上传文件名编码还原', () => {
  it('还原 multer latin1 强转的中文文件名', () => {
    // 模拟 multer 1.x 在 Windows 下按 latin1 逐字节解码 UTF-8 文件名得到的结果
    const mojibake = Buffer.from('Git教程：怎么操作.docx', 'utf8').toString('latin1');
    expect(decodeUploadFilename(mojibake)).toBe('Git教程：怎么操作.docx');
  });

  it('还原含标点（省略号/书名号/破折号）的中文文件名', () => {
    const mojibake = Buffer.from('《Git 入门》—基础篇·速查.docx', 'utf8').toString('latin1');
    expect(decodeUploadFilename(mojibake)).toBe('《Git 入门》—基础篇·速查.docx');
  });

  it('纯 ASCII 文件名保持不变', () => {
    expect(decodeUploadFilename('report-2024.docx')).toBe('report-2024.docx');
    expect(decodeUploadFilename('data.csv')).toBe('data.csv');
  });

  it('还原后扩展名正确（ASCII 尾缀不受影响）', () => {
    const mojibake = Buffer.from('宏观经济数据.xlsx', 'utf8').toString('latin1');
    expect(decodeUploadFilename(mojibake)).toBe('宏观经济数据.xlsx');
  });
});
