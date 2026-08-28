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
import { AdminSearchOpsService } from './search-ops.service';
import { AdminAuditService } from './admin-audit.service';
import {
  AdminTermFlagsSchema,
  AdminSensitiveCreateSchema,
  AdminSensitiveUpdateSchema,
  AdminSensitiveEnabledSchema,
} from './dto';
import type {
  AdminTermFlags,
  AdminSensitiveCreate,
  AdminSensitiveUpdate,
  AdminSensitiveEnabled,
} from './dto';

/**
 * 运营管理 · 搜索运营（A-10）：搜索词统计（热门/无结果）+ 敏感词 CRUD。
 * 仅平台管理员可访问。
 */
@Controller('admin/search-ops')
@Roles(RoleCode.PLATFORM_ADMIN)
export class AdminSearchOpsController {
  constructor(
    private readonly searchOps: AdminSearchOpsService,
    private readonly audit: AdminAuditService,
  ) {}

  /** 搜索词统计（?kind=hot|empty） */
  @Get('terms')
  @HttpCode(HttpStatus.OK)
  listTerms(
    @Query('kind') kind: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const k = kind === 'empty' ? 'empty' : 'hot';
    return this.searchOps.listTerms(k, Number(page) || 1, Number(pageSize));
  }

  /** 搜索词运营动作：设为快捷检索 / 加入搜索建议 */
  @Patch('terms/:id/flags')
  @HttpCode(HttpStatus.OK)
  async setTermFlags(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminTermFlagsSchema)) body: AdminTermFlags,
  ) {
    const row = await this.searchOps.setTermFlags(id, body);
    await this.audit.record({ targetType: 'SEARCH_TERM', targetId: id, detail: { term: row.term, ...body } });
    return row;
  }

  /** 敏感词列表 */
  @Get('sensitive')
  @HttpCode(HttpStatus.OK)
  listSensitive(
    @Query('keyword') keyword?: string,
    @Query('enabled') enabled?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.searchOps.listSensitive({
      keyword,
      enabled,
      page: Number(page) || 1,
      pageSize: Number(pageSize),
    });
  }

  /** 新增敏感词 */
  @Post('sensitive')
  @HttpCode(HttpStatus.CREATED)
  async createSensitive(@Body(new ZodValidationPipe(AdminSensitiveCreateSchema)) body: AdminSensitiveCreate) {
    const row = await this.searchOps.createSensitive(body);
    await this.audit.record({ targetType: 'SENSITIVE_WORD', targetId: row.id, detail: { word: row.word } });
    return row;
  }

  /** 编辑敏感词 */
  @Put('sensitive/:id')
  @HttpCode(HttpStatus.OK)
  async updateSensitive(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminSensitiveUpdateSchema)) body: AdminSensitiveUpdate,
  ) {
    const row = await this.searchOps.updateSensitive(id, body);
    await this.audit.record({ targetType: 'SENSITIVE_WORD', targetId: id, detail: { word: row.word } });
    return row;
  }

  /** 敏感词启用/停用 */
  @Patch('sensitive/:id')
  @HttpCode(HttpStatus.OK)
  async setSensitiveEnabled(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminSensitiveEnabledSchema)) body: AdminSensitiveEnabled,
  ) {
    const result = await this.searchOps.setSensitiveEnabled(id, body);
    await this.audit.record({ targetType: 'SENSITIVE_WORD', targetId: id, detail: { enabled: result.enabled } });
    return result;
  }
}
