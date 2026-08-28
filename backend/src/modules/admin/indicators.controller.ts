import {
  Body,
  Controller,
  Delete,
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
import { AdminIndicatorsService } from './indicators.service';
import { AdminAuditService } from './admin-audit.service';
import {
  AdminIndicatorCreateSchema,
  AdminIndicatorUpdateSchema,
  AdminMappingCreateSchema,
  AdminMappingUpdateSchema,
} from './dto';
import type {
  AdminIndicatorCreate,
  AdminIndicatorUpdate,
  AdminMappingCreate,
  AdminMappingUpdate,
} from './dto';

/**
 * 数据资源 · 指标管理（A-05）：指标 CRUD + 来源映射 CRUD。
 * 平台管理员 + 数据管理员可访问（对齐 A-04 权限矩阵）。
 */
@Controller('admin/indicators')
@Roles(RoleCode.PLATFORM_ADMIN, RoleCode.DATA_ADMIN)
export class AdminIndicatorsController {
  constructor(
    private readonly indicators: AdminIndicatorsService,
    private readonly audit: AdminAuditService,
  ) {}

  /** 指标列表 */
  @Get()
  @HttpCode(HttpStatus.OK)
  list(
    @Query('keyword') keyword?: string,
    @Query('category') category?: string,
    @Query('enabled') enabled?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.indicators.list({
      keyword,
      category,
      enabled,
      page: Number(page) || 1,
      pageSize: Number(pageSize),
    });
  }

  /** 新增指标 */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body(new ZodValidationPipe(AdminIndicatorCreateSchema)) body: AdminIndicatorCreate) {
    const row = await this.indicators.create(body);
    await this.audit.record({ targetType: 'INDICATOR', targetId: row.id, detail: { code: row.code } });
    return row;
  }

  /** 编辑指标 */
  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminIndicatorUpdateSchema)) body: AdminIndicatorUpdate,
  ) {
    const row = await this.indicators.update(id, body);
    await this.audit.record({ targetType: 'INDICATOR', targetId: id, detail: { code: row.code } });
    return row;
  }

  /** 删除指标（被映射占用时禁删） */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string) {
    const result = await this.indicators.remove(id);
    await this.audit.record({ targetType: 'INDICATOR', targetId: id, detail: { action: 'delete' } });
    return result;
  }

  /** 指标来源映射列表 */
  @Get(':id/mappings')
  @HttpCode(HttpStatus.OK)
  listMappings(@Param('id') id: string) {
    return this.indicators.listMappings(id);
  }

  /** 新增来源映射 */
  @Post(':id/mappings')
  @HttpCode(HttpStatus.CREATED)
  async createMapping(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminMappingCreateSchema)) body: AdminMappingCreate,
  ) {
    const row = await this.indicators.createMapping(id, body);
    await this.audit.record({ targetType: 'INDICATOR_MAPPING', targetId: row.id, detail: { sourceName: row.sourceName } });
    return row;
  }

  /** 编辑来源映射 */
  @Put(':id/mappings/:mid')
  @HttpCode(HttpStatus.OK)
  async updateMapping(
    @Param('id') id: string,
    @Param('mid') mid: string,
    @Body(new ZodValidationPipe(AdminMappingUpdateSchema)) body: AdminMappingUpdate,
  ) {
    const row = await this.indicators.updateMapping(mid, body);
    await this.audit.record({ targetType: 'INDICATOR_MAPPING', targetId: mid, detail: { indicatorId: id } });
    return row;
  }

  /** 删除来源映射 */
  @Delete(':id/mappings/:mid')
  @HttpCode(HttpStatus.OK)
  async removeMapping(@Param('id') id: string, @Param('mid') mid: string) {
    const result = await this.indicators.removeMapping(mid);
    await this.audit.record({ targetType: 'INDICATOR_MAPPING', targetId: mid, detail: { indicatorId: id } });
    return result;
  }
}
