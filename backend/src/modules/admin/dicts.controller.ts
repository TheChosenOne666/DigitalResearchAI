import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { RoleCode, Roles } from '../../common/auth/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminDictsService } from './dicts.service';
import { AdminAuditService } from './admin-audit.service';
import {
  AdminDictCreateSchema,
  AdminDictUpdateSchema,
  AdminDictEnabledSchema,
} from './dto';
import type { AdminDictCreate, AdminDictUpdate, AdminDictEnabled } from './dto';

/**
 * 数据资源 · 字典管理（A-06）：五类字典共用 CRUD（无删除，停用代替）。
 * 平台管理员 + 数据管理员可访问。
 */
@Controller('admin/dicts')
@Roles(RoleCode.PLATFORM_ADMIN, RoleCode.DATA_ADMIN)
export class AdminDictsController {
  constructor(
    private readonly dicts: AdminDictsService,
    private readonly audit: AdminAuditService,
  ) {}

  /** 字典列表（type 必填） */
  @Get()
  @HttpCode(HttpStatus.OK)
  list(
    @Query('type') type: string,
    @Query('keyword') keyword?: string,
    @Query('enabled') enabled?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.dicts.list({
      type,
      keyword,
      enabled,
      page: Number(page) || 1,
      pageSize: Number(pageSize),
    });
  }

  /** 新增字典项 */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body(new ZodValidationPipe(AdminDictCreateSchema)) body: AdminDictCreate) {
    const row = await this.dicts.create(body);
    await this.audit.record({ targetType: 'DICT_ITEM', targetId: row.id, detail: { type: row.type, code: row.code } });
    return row;
  }

  /** 编辑字典项（type/code 不可改） */
  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminDictUpdateSchema)) body: AdminDictUpdate,
  ) {
    const row = await this.dicts.update(id, body);
    await this.audit.record({ targetType: 'DICT_ITEM', targetId: id, detail: { code: row.code } });
    return row;
  }

  /** 停用/启用字典项 */
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async setEnabled(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminDictEnabledSchema)) body: AdminDictEnabled,
  ) {
    const result = await this.dicts.setEnabled(id, body);
    await this.audit.record({ targetType: 'DICT_ITEM', targetId: id, detail: { enabled: result.enabled } });
    return result;
  }
}
