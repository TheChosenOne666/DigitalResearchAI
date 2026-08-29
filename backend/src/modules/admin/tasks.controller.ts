import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { RoleCode, Roles } from '../../common/auth/roles.decorator';
import { AdminTasksService } from './tasks.service';
import { AdminAuditService } from './admin-audit.service';

/**
 * 任务中心 · 后台任务监控（A-11）：任务列表 + 重试/终止/日志。
 * 平台管理员与数据管理员均可访问（权限矩阵 4.2）。
 */
@Controller('admin/tasks')
@Roles(RoleCode.PLATFORM_ADMIN, RoleCode.DATA_ADMIN)
export class AdminTasksController {
  constructor(
    private readonly tasks: AdminTasksService,
    private readonly audit: AdminAuditService,
  ) {}

  /** 任务列表 */
  @Get()
  @HttpCode(HttpStatus.OK)
  list(
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.tasks.list({
      type,
      status,
      keyword,
      page: Number(page) || 1,
      pageSize: Number(pageSize),
    });
  }

  /** 重试失败任务（重试上限 3 次） */
  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  async retry(@Param('id') id: string) {
    const row = await this.tasks.retry(id);
    await this.audit.record({ targetType: 'SYS_TASK', targetId: id, detail: { action: 'retry', taskNo: row.taskNo } });
    return row;
  }

  /** 终止任务（不可逆，前端二次确认） */
  @Post(':id/stop')
  @HttpCode(HttpStatus.OK)
  async stop(@Param('id') id: string) {
    const row = await this.tasks.stop(id);
    await this.audit.record({ targetType: 'SYS_TASK', targetId: id, detail: { action: 'stop', taskNo: row.taskNo } });
    return row;
  }

  /** 任务日志 */
  @Get(':id/logs')
  @HttpCode(HttpStatus.OK)
  logs(@Param('id') id: string) {
    return this.tasks.logs(id);
  }
}
