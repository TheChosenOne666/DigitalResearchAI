import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { RoleCode, Roles } from '../../common/auth/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminImportsService } from './imports.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminImportRejectSchema } from './dto';
import type { AdminImportReject } from './dto';

/**
 * 数据治理 · 数据接入审核（A-08）：审核队列 / 预览 / 通过 / 退回。
 * 平台管理员 + 数据管理员可访问。
 */
@Controller('admin/imports')
@Roles(RoleCode.PLATFORM_ADMIN, RoleCode.DATA_ADMIN)
export class AdminImportsController {
  constructor(
    private readonly imports: AdminImportsService,
    private readonly audit: AdminAuditService,
  ) {}

  /** 审核队列 */
  @Get()
  @HttpCode(HttpStatus.OK)
  list(
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.imports.list({
      status,
      type,
      page: Number(page) || 1,
      pageSize: Number(pageSize),
    });
  }

  /** 数据预览 */
  @Get(':id/preview')
  @HttpCode(HttpStatus.OK)
  preview(@Param('id') id: string) {
    return this.imports.preview(id);
  }

  /** 审核通过 */
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(@Param('id') id: string) {
    const result = await this.imports.approve(id);
    await this.audit.record({ targetType: 'IMPORT_TASK', targetId: id, detail: { action: 'approve' } });
    return result;
  }

  /** 审核退回（原因必填） */
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminImportRejectSchema)) body: AdminImportReject,
  ) {
    const result = await this.imports.reject(id, body);
    await this.audit.record({ targetType: 'IMPORT_TASK', targetId: id, detail: { action: 'reject', reason: body.reason } });
    return result;
  }
}
