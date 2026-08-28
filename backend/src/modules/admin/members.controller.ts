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
import { AdminMembersService } from './members.service';
import { AdminAuditService } from './admin-audit.service';
import {
  AdminPlanCreateSchema,
  AdminPlanUpdateSchema,
  AdminPlanEnabledSchema,
  AdminBatchRenewalSchema,
} from './dto';
import type {
  AdminPlanCreate,
  AdminPlanUpdate,
  AdminPlanEnabled,
  AdminBatchRenewal,
} from './dto';

/**
 * 组织用户 · 会员管理（A-03）：会员等级 CRUD / 缴费订单 / 续费提醒。
 * 仅平台管理员可访问（对齐 A-04 权限矩阵）。
 */
@Controller('admin/members')
@Roles(RoleCode.PLATFORM_ADMIN)
export class AdminMembersController {
  constructor(
    private readonly members: AdminMembersService,
    private readonly audit: AdminAuditService,
  ) {}

  /** 会员套餐列表（含停用） */
  @Get('plans')
  @HttpCode(HttpStatus.OK)
  listPlans() {
    return this.members.listPlans();
  }

  /** 新增会员套餐 */
  @Post('plans')
  @HttpCode(HttpStatus.CREATED)
  async createPlan(@Body(new ZodValidationPipe(AdminPlanCreateSchema)) body: AdminPlanCreate) {
    const plan = await this.members.createPlan(body);
    await this.audit.record({ targetType: 'MEMBER_PLAN', targetId: plan.id, detail: { code: plan.code } });
    return plan;
  }

  /** 编辑会员套餐（编码不可改） */
  @Put('plans/:id')
  @HttpCode(HttpStatus.OK)
  async updatePlan(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminPlanUpdateSchema)) body: AdminPlanUpdate,
  ) {
    const plan = await this.members.updatePlan(id, body);
    await this.audit.record({ targetType: 'MEMBER_PLAN', targetId: id, detail: { code: plan.code } });
    return plan;
  }

  /** 会员套餐上下架 */
  @Patch('plans/:id/enabled')
  @HttpCode(HttpStatus.OK)
  async setPlanEnabled(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminPlanEnabledSchema)) body: AdminPlanEnabled,
  ) {
    const result = await this.members.setPlanEnabled(id, body);
    await this.audit.record({ targetType: 'MEMBER_PLAN', targetId: id, detail: { enabled: result.enabled } });
    return result;
  }

  /** 缴费订单列表（跨租户） */
  @Get('orders')
  @HttpCode(HttpStatus.OK)
  listOrders(
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.members.listOrders({
      status,
      keyword,
      page: Number(page) || 1,
      pageSize: Number(pageSize),
    });
  }

  /** 7 天内到期会员 + 提醒状态 */
  @Get('renewals')
  @HttpCode(HttpStatus.OK)
  listRenewals() {
    return this.members.listRenewals();
  }

  /** 发送单条续费提醒 */
  @Post('renewals/:userId/send')
  @HttpCode(HttpStatus.OK)
  async sendRenewal(@Param('userId') userId: string) {
    const result = await this.members.sendRenewal(userId);
    await this.audit.record({ targetType: 'RENEWAL', targetId: userId });
    return result;
  }

  /** 批量续费提醒 */
  @Post('renewals/batch')
  @HttpCode(HttpStatus.OK)
  async batchRenewal(@Body(new ZodValidationPipe(AdminBatchRenewalSchema)) body: AdminBatchRenewal) {
    const result = await this.members.batchRenewal(body);
    await this.audit.record({ targetType: 'RENEWAL', detail: { sent: result.sent } });
    return result;
  }
}
