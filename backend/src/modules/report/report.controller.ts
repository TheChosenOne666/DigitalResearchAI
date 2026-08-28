import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import { ReportService } from './report.service';

/** 报告导出入参 */
interface ExportBody {
  type?: string;
  id?: string;
  format?: string;
}

const VALID_TYPES = new Set(['search', 'workspace']);
const VALID_FORMATS = new Set(['docx', 'pptx']);

/** 校验并归一化导出入参（非法返回错误文案，通过返回 null） */
function normalizeExport(body: ExportBody | undefined): { type: 'search' | 'workspace'; id: string; format: 'docx' | 'pptx' } | string {
  if (!body || typeof body !== 'object') return '缺少导出参数';
  const { type, id, format } = body;
  if (!type || !VALID_TYPES.has(type)) return '报告类型不合法（search / workspace）';
  if (!id || typeof id !== 'string') return '缺少报告 ID';
  if (!format || !VALID_FORMATS.has(format)) return '导出格式不合法（docx / pptx）';
  return { type: type as 'search' | 'workspace', id, format: format as 'docx' | 'pptx' };
}

/**
 * 报告导出控制器（M4.4）：POST /report/export 返回 Word/PPT 二进制流。
 * 直接经 @Res 写流，绕过统一响应体包装。
 */
@Controller('report')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Post('export')
  @HttpCode(HttpStatus.OK)
  async export(@Body() body: ExportBody, @Res() res: Response): Promise<void> {
    const input = normalizeExport(body);
    if (typeof input === 'string') {
      throw new BizException(ErrorCode.VALIDATION_FAILED, input, HttpStatus.BAD_REQUEST);
    }
    const result = await this.reportService.export(input);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
    );
    res.setHeader('Content-Length', result.buffer.byteLength);
    res.end(result.buffer);
  }
}
