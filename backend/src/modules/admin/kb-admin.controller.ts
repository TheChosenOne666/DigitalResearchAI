import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { RoleCode, Roles } from '../../common/auth/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminAuditService } from './admin-audit.service';
import { AdminKbService } from './kb-admin.service';
import {
  AdminKbRejectSchema, AdminKbCategoryCreateSchema, AdminKbCategoryUpdateSchema,
  AdminKbEnabledSchema, AdminKbTagCreateSchema, AdminKbTagUpdateSchema,
  AdminKbPermissionRuleSchema, AdminKbItemVisibilitySchema, AdminIndexIncrementSchema,
  type AdminKbReject, type AdminKbCategoryCreate, type AdminKbCategoryUpdate,
  type AdminKbEnabled, type AdminKbTagCreate, type AdminKbTagUpdate,
  type AdminKbPermissionRule, type AdminKbItemVisibility, type AdminIndexIncrement,
} from './dto';

/**
 * 知识库管理（A-16~A-19，M6.5）：知识审核 / 分类标签 / 权限 / 索引，仅平台管理员。
 * 接口前缀 /api/v1/admin/kb，跨租户数据访问（D1/D3）。
 */
@Controller('admin/kb')
@Roles(RoleCode.PLATFORM_ADMIN)
export class AdminKbController {
  constructor(
    private readonly kb: AdminKbService,
    private readonly audit: AdminAuditService,
  ) {}

  // ===== A-16 知识审核 =====

  /** 待审核条目列表（跨租户，含四项校验结果） */
  @Get('reviews')
  @HttpCode(HttpStatus.OK)
  listReviews(
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.kb.listReviews({ keyword, page: Number(page) || 1, pageSize: Number(pageSize) || 20 });
  }

  /** 审核通过（触发学习） */
  @Post('reviews/:id/approve')
  @HttpCode(HttpStatus.OK)
  async approveReview(@Param('id') id: string) {
    const res = await this.kb.approveReview(id);
    await this.audit.record({ targetType: 'KB_DOCUMENT', targetId: id, detail: { action: 'approve', status: res.status } });
    return res;
  }

  /** 审核驳回（原因必填，删除待审核文档） */
  @Post('reviews/:id/reject')
  @HttpCode(HttpStatus.OK)
  async rejectReview(@Param('id') id: string, @Body(new ZodValidationPipe(AdminKbRejectSchema)) body: AdminKbReject) {
    const res = await this.kb.rejectReview(id, body.reason);
    await this.audit.record({ targetType: 'KB_DOCUMENT', targetId: id, detail: { action: 'reject', reason: body.reason } });
    return res;
  }

  /** 来源溯源 */
  @Get('reviews/:id/trace')
  @HttpCode(HttpStatus.OK)
  trace(@Param('id') id: string) {
    return this.kb.trace(id);
  }

  // ===== A-17 分类 / 标签 =====

  @Get('categories')
  @HttpCode(HttpStatus.OK)
  listCategories() {
    return this.kb.listCategories();
  }

  @Post('categories')
  @HttpCode(HttpStatus.CREATED)
  async createCategory(@Body(new ZodValidationPipe(AdminKbCategoryCreateSchema)) body: AdminKbCategoryCreate) {
    const row = await this.kb.createCategory(body);
    await this.audit.record({ targetType: 'KB_CATEGORY', targetId: row.id, detail: { action: 'create', name: row.name, parentId: row.parentId } });
    return row;
  }

  @Put('categories/:id')
  @HttpCode(HttpStatus.OK)
  async updateCategory(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminKbCategoryUpdateSchema)) body: AdminKbCategoryUpdate,
  ) {
    const row = await this.kb.updateCategory(id, body);
    await this.audit.record({ targetType: 'KB_CATEGORY', targetId: id, detail: { action: 'update', ...body } });
    return row;
  }

  @Patch('categories/:id/enabled')
  @HttpCode(HttpStatus.OK)
  async setCategoryEnabled(@Param('id') id: string, @Body(new ZodValidationPipe(AdminKbEnabledSchema)) body: AdminKbEnabled) {
    const res = await this.kb.setCategoryEnabled(id, body.enabled);
    await this.audit.record({ targetType: 'KB_CATEGORY', targetId: id, detail: { action: body.enabled ? 'enable' : 'disable' } });
    return res;
  }

  @Get('tags')
  @HttpCode(HttpStatus.OK)
  listTags() {
    return this.kb.listTags();
  }

  @Post('tags')
  @HttpCode(HttpStatus.CREATED)
  async createTag(@Body(new ZodValidationPipe(AdminKbTagCreateSchema)) body: AdminKbTagCreate) {
    const row = await this.kb.createTag(body);
    await this.audit.record({ targetType: 'KB_TAG', targetId: row.id, detail: { action: 'create', name: row.name } });
    return row;
  }

  @Put('tags/:id')
  @HttpCode(HttpStatus.OK)
  async updateTag(@Param('id') id: string, @Body(new ZodValidationPipe(AdminKbTagUpdateSchema)) body: AdminKbTagUpdate) {
    const row = await this.kb.updateTag(id, body);
    await this.audit.record({ targetType: 'KB_TAG', targetId: id, detail: { action: 'update', ...body } });
    return row;
  }

  @Patch('tags/:id/enabled')
  @HttpCode(HttpStatus.OK)
  async setTagEnabled(@Param('id') id: string, @Body(new ZodValidationPipe(AdminKbEnabledSchema)) body: AdminKbEnabled) {
    const res = await this.kb.setTagEnabled(id, body.enabled);
    await this.audit.record({ targetType: 'KB_TAG', targetId: id, detail: { action: body.enabled ? 'enable' : 'disable' } });
    return res;
  }

  // ===== A-18 权限管理 =====

  @Get('permission/rule')
  @HttpCode(HttpStatus.OK)
  getPermissionRule() {
    return this.kb.getPermissionRule();
  }

  @Put('permission/rule')
  @HttpCode(HttpStatus.OK)
  async updatePermissionRule(@Body(new ZodValidationPipe(AdminKbPermissionRuleSchema)) body: AdminKbPermissionRule) {
    const res = await this.kb.updatePermissionRule(body);
    await this.audit.record({ targetType: 'SYS_CONFIG', targetId: 'kb.permission', detail: { action: 'update-rule', ...body } });
    return res;
  }

  @Get('permission/items')
  @HttpCode(HttpStatus.OK)
  listPermissionItems(
    @Query('keyword') keyword?: string,
    @Query('visibility') visibility?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.kb.listPermissionItems({
      keyword, visibility, page: Number(page) || 1, pageSize: Number(pageSize) || 20,
    });
  }

  @Patch('permission/items/:id')
  @HttpCode(HttpStatus.OK)
  async setItemVisibility(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminKbItemVisibilitySchema)) body: AdminKbItemVisibility,
  ) {
    const res = await this.kb.setItemVisibility(id, body.visibility);
    await this.audit.record({ targetType: 'KB_DOCUMENT', targetId: id, detail: { action: 'set-visibility', visibility: body.visibility } });
    return res;
  }

  // ===== A-19 索引管理 =====

  @Get('index/stats')
  @HttpCode(HttpStatus.OK)
  indexStats() {
    return this.kb.indexStats();
  }

  /** 发起索引重建（全量） */
  @Post('index/rebuild')
  @HttpCode(HttpStatus.CREATED)
  async rebuildIndex() {
    const res = await this.kb.createIndexTask('REBUILD');
    await this.audit.record({ targetType: 'SYS_TASK', targetId: res.id, detail: { action: 'index-rebuild', taskNo: res.taskNo } });
    return res;
  }

  /** 发起增量更新（含策略） */
  @Post('index/increment')
  @HttpCode(HttpStatus.CREATED)
  async incrementIndex(@Body(new ZodValidationPipe(AdminIndexIncrementSchema)) body: AdminIndexIncrement) {
    const res = await this.kb.createIndexTask('INCREMENT', body.strategy);
    await this.audit.record({ targetType: 'SYS_TASK', targetId: res.id, detail: { action: 'index-increment', taskNo: res.taskNo, strategy: body.strategy } });
    return res;
  }

  /** 发起脏数据清理 */
  @Post('index/clean')
  @HttpCode(HttpStatus.CREATED)
  async cleanIndex() {
    const res = await this.kb.createIndexTask('CLEAN');
    await this.audit.record({ targetType: 'SYS_TASK', targetId: res.id, detail: { action: 'index-clean', taskNo: res.taskNo } });
    return res;
  }
}
