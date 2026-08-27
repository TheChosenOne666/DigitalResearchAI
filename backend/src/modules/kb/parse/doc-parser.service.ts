import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { BizException } from '../../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';

/** 支持解析的文件类型（mimeType 字段值） */
export type DocMimeType = 'xlsx' | 'csv' | 'docx' | 'pdf' | 'txt' | 'md';

/** 支持的 mime 集合（用于上传校验） */
export const SUPPORTED_MIME = new Set<string>(['xlsx', 'csv', 'docx', 'pdf', 'txt', 'md']);

/** 根据文件名推断 mimeType（扩展名 → mime），未知返回 'txt' */
export function detectMimeType(filename: string): DocMimeType {
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  switch (ext) {
    case 'xlsx':
    case 'xls':
      return 'xlsx';
    case 'csv':
      return 'csv';
    case 'docx':
    case 'doc':
      return 'docx';
    case 'pdf':
      return 'pdf';
    case 'txt':
      return 'txt';
    case 'md':
      return 'md';
    default:
      return 'txt';
  }
}

/**
 * 文档解析服务（M3.2）：把上传文件的原始字节解析为纯文本。
 * 支持 Excel/CSV/Word/PDF/文本；解析失败抛业务异常（由上层将文档置 FAILED）。
 * 依赖 xlsx / mammoth / pdf-parse，按需动态 import 以降低启动开销。
 */
@Injectable()
export class DocParserService {
  private readonly logger = new Logger(DocParserService.name);

  /**
   * 解析文件字节为纯文本。
   * @param mimeType 文件 mime 类型
   * @param buffer 文件原始字节
   * @param filename 原文件名（用于 CSVo 编码/表头推断，可空）
   * @returns 解析出的纯文本
   * @throws BizException 解析失败或 mime 不支持
   */
  async parse(mimeType: DocMimeType, buffer: Buffer, filename?: string): Promise<string> {
    switch (mimeType) {
      case 'xlsx':
        return this.parseXlsx(buffer);
      case 'csv':
        return this.parseCsv(buffer, filename);
      case 'docx':
        return this.parseDocx(buffer);
      case 'pdf':
        return this.parsePdf(buffer);
      case 'txt':
      case 'md':
        return buffer.toString('utf8');
      default:
        throw new BizException(
          ErrorCode.VALIDATION_FAILED,
          `不支持的文件类型: ${mimeType}`,
          HttpStatus.BAD_REQUEST,
        );
    }
  }

  /** 解析 Excel：遍历所有 sheet，把单元格拼成表格文本 */
  private async parseXlsx(buffer: Buffer): Promise<string> {
    try {
      // 动态 require：避免在未安装/启动时阻塞
      const XLSX = await import('xlsx');
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const lines: string[] = [];
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as unknown[][];
        lines.push(`## Sheet: ${sheetName}`);
        for (const row of rows) {
          if (Array.isArray(row) && row.some((c) => String(c ?? '').trim() !== '')) {
            lines.push(row.map((c) => String(c ?? '')).join('\t'));
          }
        }
      }
      const text = lines.join('\n');
      if (!text.trim()) {
        throw new Error('Excel 内容为空');
      }
      return text;
    } catch (e) {
      throw this.wrap('Excel 解析失败', e);
    }
  }

  /** 解析 CSV：按行读，逗号/制表符分隔单元格 */
  private parseCsv(buffer: Buffer, _filename?: string): string {
    const text = buffer.toString('utf8');
    const rows = text
      .split(/\r?\n/)
      .map((r) => r.trim())
      .filter(Boolean);
    return rows.join('\n');
  }

  /** 解析 Word（docx）：提取段落纯文本 */
  private async parseDocx(buffer: Buffer): Promise<string> {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      const text = (result.value ?? '').trim();
      if (!text) throw new Error('Word 内容为空');
      return text;
    } catch (e) {
      throw this.wrap('Word 解析失败', e);
    }
  }

  /** 解析 PDF：逐页提取文本 */
  private async parsePdf(buffer: Buffer): Promise<string> {
    try {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();
      const text = (result?.text ?? '').trim();
      await parser.destroy();
      if (!text) throw new Error('PDF 内容为空');
      return text;
    } catch (e) {
      throw this.wrap('PDF 解析失败', e);
    }
  }

  /** 统一包装解析异常为业务异常，并记录日志 */
  private wrap(context: string, cause: unknown): BizException {
    const msg = cause instanceof Error ? cause.message : String(cause);
    this.logger.warn(`${context}: ${msg}`);
    return new BizException(ErrorCode.VALIDATION_FAILED, `${context}：${msg}`, HttpStatus.BAD_REQUEST);
  }
}