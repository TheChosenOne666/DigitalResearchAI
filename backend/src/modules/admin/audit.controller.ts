import { Controller, Get, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { RoleCode, Roles } from '../../common/auth/roles.decorator';
import { AdminAuditService } from './admin-audit.service';

/**
 * 系统管理 · 操作审计（A-13）：登录/导出/删除三类日志查询（只读）。
 * 仅平台管理员可访问。
 */
@Controller('admin/audit')
@Roles(RoleCode.PLATFORM_ADMIN)
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}

  /** 审计查询（tab=login|export|delete + 关键词 + 结果 + 时间窗口） */
  @Get()
  @HttpCode(HttpStatus.OK)
  query(
    @Query('tab') tab?: string,
    @Query('keyword') keyword?: string,
    @Query('result') result?: string,
    @Query('days') days?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.audit.query({
      tab: tab ?? 'login',
      keyword,
      result,
      days: Number(days) || 7,
      page: Number(page) || 1,
      pageSize: Number(pageSize),
    });
  }
}
