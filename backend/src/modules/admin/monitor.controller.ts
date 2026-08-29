import { Controller, Get, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { RoleCode, Roles } from '../../common/auth/roles.decorator';
import { AdminMonitorService } from './monitor.service';

/**
 * 系统管理 · 运行监控（A-14）：服务健康真实探测 + 错误日志查询。
 * 仅平台管理员可访问。
 */
@Controller('admin/monitor')
@Roles(RoleCode.PLATFORM_ADMIN)
export class AdminMonitorController {
  constructor(private readonly monitor: AdminMonitorService) {}

  /** 服务健康看板（API/PG/Redis/Qdrant 真实探测） */
  @Get('health')
  @HttpCode(HttpStatus.OK)
  health() {
    return this.monitor.healthStatus();
  }

  /** 错误日志（任务 ERROR + 平台级安全事件） */
  @Get('errors')
  @HttpCode(HttpStatus.OK)
  errors(
    @Query('source') source?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.monitor.errors({
      source,
      keyword,
      page: Number(page) || 1,
      pageSize: Number(pageSize),
    });
  }
}
