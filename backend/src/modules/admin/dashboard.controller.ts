import { Controller, Get, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { RoleCode, Roles } from '../../common/auth/roles.decorator';
import { DashboardService } from './dashboard.service';

/**
 * 运营看板（A-01）：平台整体运行总览。
 * 平台管理员与数据管理员均可查看（对齐原型 A-04 权限矩阵）。
 */
@Controller('admin/dashboard')
@Roles(RoleCode.PLATFORM_ADMIN, RoleCode.DATA_ADMIN)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /**
   * 运营看板聚合数据。
   * @param range 统计周期：today（今日）/ 7d（近 7 日，默认）/ 30d（近 30 日）
   */
  @Get('overview')
  @HttpCode(HttpStatus.OK)
  overview(@Query('range') range = '7d') {
    return this.dashboard.overview(range);
  }
}
