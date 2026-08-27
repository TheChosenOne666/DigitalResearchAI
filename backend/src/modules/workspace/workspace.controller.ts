import { Controller, Get, HttpCode, HttpStatus, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { WorkspaceService } from './workspace.service';

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
}
