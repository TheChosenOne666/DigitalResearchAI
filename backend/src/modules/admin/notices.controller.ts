import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { RoleCode, Roles } from '../../common/auth/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminNoticesService } from './notices.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminNoticeCreateSchema, AdminNoticeUpdateSchema } from './dto';
import type { AdminNoticeCreate, AdminNoticeUpdate } from './dto';

/**
 * 运营管理 · 消息公告（A-09）：公告 CRUD + 发布/撤回。
 * 仅平台管理员可访问。
 */
@Controller('admin/notices')
@Roles(RoleCode.PLATFORM_ADMIN)
export class AdminNoticesController {
  constructor(
    private readonly notices: AdminNoticesService,
    private readonly audit: AdminAuditService,
  ) {}

  /** 公告列表 */
  @Get()
  @HttpCode(HttpStatus.OK)
  list(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.notices.list({
      status,
      page: Number(page) || 1,
      pageSize: Number(pageSize),
    });
  }

  /** 新建公告（草稿） */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body(new ZodValidationPipe(AdminNoticeCreateSchema)) body: AdminNoticeCreate) {
    const row = await this.notices.create(body);
    await this.audit.record({ targetType: 'NOTICE', targetId: row.id, detail: { title: row.title } });
    return row;
  }

  /** 编辑公告 */
  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminNoticeUpdateSchema)) body: AdminNoticeUpdate,
  ) {
    const row = await this.notices.update(id, body);
    await this.audit.record({ targetType: 'NOTICE', targetId: id, detail: { title: row.title } });
    return row;
  }

  /** 发布公告 */
  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  async publish(@Param('id') id: string) {
    const result = await this.notices.publish(id);
    await this.audit.record({ targetType: 'NOTICE', targetId: id, detail: { action: 'publish' } });
    return result;
  }

  /** 撤回公告 */
  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  async withdraw(@Param('id') id: string) {
    const result = await this.notices.withdraw(id);
    await this.audit.record({ targetType: 'NOTICE', targetId: id, detail: { action: 'withdraw' } });
    return result;
  }
}
