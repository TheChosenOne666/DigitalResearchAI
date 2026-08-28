import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import { WorkspaceService } from './workspace.service';
import { AnalyzeService } from './analyze.service';
import { WorkspaceStoreService } from './workspace.store.service';
import { detectMimeType } from '../kb/parse/doc-parser.service';
import { serializeSse } from '../search/sse/sse.events';
import type { AnalyzeInput } from './analyze';

/** 上传文件最小形状（避免依赖 @types/multer） */
interface UploadedFileShape {
  originalname: string;
  buffer: Buffer;
}

/** 分析结果存入知识库入参 */
export interface AnalyzeSaveKbBody {
  libraryId?: string;
  groupId?: string | null;
  visibility?: string;
  tags?: unknown;
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

/** 分析输入基本校验（返回错误文案，通过返回 null） */
function validateAnalyzeInput(body: AnalyzeInput | undefined): string | null {
  if (!body || typeof body !== 'object') return '缺少分析参数';
  if (!body.indicator || typeof body.indicator.name !== 'string' || !body.indicator.name.trim()) {
    return '缺少指标信息';
  }
  if (!Array.isArray(body.years) || !body.years.length) return '缺少年份维度';
  if (!Array.isArray(body.series) || !body.series.length) return '缺少时序数据，请先选择国家/地区';
  return null;
}

/**
 * 数据工作台控制器（M4）：时序数据查询 + 上传补充 + 分析结果生成/详情/存库。
 * 登录门禁由全局 SessionAuthGuard 保证；WDI 为公共数据，无需租户上下文。
 */
@Controller('workspace')
export class WorkspaceController {
  constructor(
    private readonly workspace: WorkspaceService,
    private readonly analyzeService: AnalyzeService,
    private readonly store: WorkspaceStoreService,
  ) {}

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

  /**
   * 生成分析结果（M4.3）：SSE 流式，事件 stage → report_chunk → done{reportId}。
   * 客户端断开 → AbortController 全链路取消（对齐 search/stream）。
   */
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  async analyze(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: AnalyzeInput,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const ac = new AbortController();
    res.on('close', () => ac.abort());
    const send = (event: Parameters<typeof serializeSse>[0], data: unknown) =>
      res.write(serializeSse(event, data));

    try {
      const err = validateAnalyzeInput(body);
      if (err) {
        send('error', { message: err });
        return;
      }
      send('stage', { stage: 'analyzing', msg: '正在解析数据与统计口径' });
      const { reportId } = await this.analyzeService.analyze(body, ac.signal, (chunk) =>
        send('report_chunk', chunk),
      );
      send('stage', { stage: 'done', msg: '分析完成' });
      send('done', { reportId });
    } catch (e) {
      send('error', { message: e instanceof Error ? e.message : 'unknown error' });
    } finally {
      res.end();
    }
  }

  @Get('reports/:id')
  @HttpCode(HttpStatus.OK)
  reportDetail(@Param('id') id: string): Promise<unknown> {
    return this.store.reportDetail(id);
  }

  /** 整份分析结果存入知识库（M4.3）：报告正文作为一份 md 文档提交入库，待审核 */
  @Post('reports/:id/save-kb')
  @HttpCode(HttpStatus.CREATED)
  saveToKb(@Param('id') id: string, @Body() body: AnalyzeSaveKbBody): Promise<unknown> {
    return this.analyzeService.saveToKb(id, body ?? {});
  }
}
