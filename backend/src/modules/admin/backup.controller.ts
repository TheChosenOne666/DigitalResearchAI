import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { RoleCode, Roles } from '../../common/auth/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminBackupService } from './backup.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminBackupPolicySchema } from './dto';
import type { AdminBackupPolicy } from './dto';

/**
 * 系统管理 · 数据备份（A-15）：备份策略 + 立即备份 + 备份记录 + 恢复。
 * D5：演示环境仅落记录与任务，不执行真实备份/恢复；恢复需二次确认并落审计。
 */
@Controller('admin/backup')
@Roles(RoleCode.PLATFORM_ADMIN)
export class AdminBackupController {
  constructor(
    private readonly backup: AdminBackupService,
    private readonly audit: AdminAuditService,
  ) {}

  /** 备份策略 */
  @Get('policy')
  @HttpCode(HttpStatus.OK)
  getPolicy() {
    return this.backup.getPolicy();
  }

  /** 保存备份策略 */
  @Put('policy')
  @HttpCode(HttpStatus.OK)
  async updatePolicy(@Body(new ZodValidationPipe(AdminBackupPolicySchema)) body: AdminBackupPolicy) {
    const policy = await this.backup.updatePolicy(body);
    await this.audit.record({ targetType: 'BACKUP_POLICY', targetId: 'policy', detail: { ...body } });
    return policy;
  }

  /** 立即备份（仅记录，不真执行） */
  @Post('now')
  @HttpCode(HttpStatus.CREATED)
  async backupNow() {
    const record = await this.backup.backupNow();
    await this.audit.record({ targetType: 'BACKUP_RECORD', targetId: record.id, detail: { action: 'backup-now' } });
    return record;
  }

  /** 备份记录 */
  @Get('records')
  @HttpCode(HttpStatus.OK)
  listRecords(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.backup.listRecords({ page: Number(page) || 1, pageSize: Number(pageSize) });
  }

  /** 恢复备份（二次确认 + 审计，不真执行） */
  @Post('records/:id/restore')
  @HttpCode(HttpStatus.OK)
  async restore(@Param('id') id: string) {
    const result = await this.backup.restore(id);
    await this.audit.record({ targetType: 'BACKUP_RECORD', targetId: id, detail: { action: 'restore' } });
    return result;
  }
}
