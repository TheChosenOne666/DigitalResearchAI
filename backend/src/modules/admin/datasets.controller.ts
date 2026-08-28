import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Put,
  Query,
} from '@nestjs/common';
import { RoleCode, Roles } from '../../common/auth/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminDatasetsService } from './datasets.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminDatasetUpdateSchema, AdminDatasetStatusSchema } from './dto';
import type { AdminDatasetUpdate, AdminDatasetStatus } from './dto';

/**
 * 数据资源 · 数据集管理（A-07）：查看 / 编辑元数据 / 上下架。
 * 平台管理员 + 数据管理员可访问。
 */
@Controller('admin/datasets')
@Roles(RoleCode.PLATFORM_ADMIN, RoleCode.DATA_ADMIN)
export class AdminDatasetsController {
  constructor(
    private readonly datasets: AdminDatasetsService,
    private readonly audit: AdminAuditService,
  ) {}

  /** 数据集列表 */
  @Get()
  @HttpCode(HttpStatus.OK)
  list(
    @Query('keyword') keyword?: string,
    @Query('source') source?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.datasets.list({
      keyword,
      source,
      status,
      page: Number(page) || 1,
      pageSize: Number(pageSize),
    });
  }

  /** 数据集详情 */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  detail(@Param('id') id: string) {
    return this.datasets.detail(id);
  }

  /** 编辑数据集元数据 */
  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminDatasetUpdateSchema)) body: AdminDatasetUpdate,
  ) {
    const row = await this.datasets.update(id, body);
    await this.audit.record({ targetType: 'DATASET', targetId: id, detail: { name: row.name } });
    return row;
  }

  /** 数据集上下架 */
  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  async setStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminDatasetStatusSchema)) body: AdminDatasetStatus,
  ) {
    const result = await this.datasets.setStatus(id, body);
    await this.audit.record({ targetType: 'DATASET', targetId: id, detail: { status: result.status } });
    return result;
  }
}
