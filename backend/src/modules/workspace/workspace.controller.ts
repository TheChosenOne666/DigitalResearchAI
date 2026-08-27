import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import { WorkspaceService } from './workspace.service';
import { detectMimeType } from '../kb/parse/doc-parser.service';

/** 上传文件最小形状（避免依赖 @types/multer） */
interface UploadedFileShape {
  originalname: string;
  buffer: Buffer;
}

/** 逗号分隔列表解析（兼容 query 重复参数产生的数组；空串/缺省 → 空数组） */
function splitList(raw?: string | string[]): string[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .flatMap((s) => s.split(','))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 解析年份为整数（非法/缺省回退默认值） */
function parseYear(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * 数据工作台控制器（M4.1）：时序数据查询。
 * 登录门禁由全局 SessionAuthGuard 保证；WDI 为公共数据，无需租户上下文。
 */
@Controller('workspace')
export class WorkspaceController {
  constructor(private readonly workspace: WorkspaceService) {}

  @Get('dataset')
  @HttpCode(HttpStatus.OK)
  async dataset(
    @Req() req: Request,
    @Query('countries') countries?: string | string[],
    @Query('indicators') indicators?: string | string[],
    @Query('yearFrom') yearFrom?: string,
    @Query('yearTo') yearTo?: string,
  ): Promise<unknown> {
    const countryList = splitList(countries);
    const indicatorList = splitList(indicators);
    // 默认时间窗：最近 10 年（截至去年），与智搜垂直路一致
    const defaultTo = new Date().getFullYear() - 1;
    const from = parseYear(yearFrom, defaultTo - 10);
    const to = parseYear(yearTo, defaultTo);
    // 客户端断开时中止 WDI 请求
    const ac = new AbortController();
    req.on('close', () => ac.abort());
    return this.workspace.getDataset(countryList, indicatorList, from, to, ac.signal);
  }

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async upload(@UploadedFile() file?: UploadedFileShape): Promise<unknown> {
    if (!file) {
      throw new BizException(ErrorCode.PARAM_MISSING, '缺少上传文件', HttpStatus.BAD_REQUEST);
    }
    const mime = detectMimeType(file.originalname);
    if (mime !== 'xlsx' && mime !== 'csv') {
      throw new BizException(
        ErrorCode.VALIDATION_FAILED,
        '仅支持 Excel（.xlsx / .xls）或 CSV 文件',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.workspace.upload(mime, file.buffer);
  }
}
