import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { RoleCode, Roles } from '../../common/auth/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminAuditService } from './admin-audit.service';
import { AdminPayService } from './pay-admin.service';
import {
  AdminPayRefundSchema, AdminPayChannelUpdateSchema, AdminPayChannelKeySchema,
  type AdminPayRefund, type AdminPayChannelUpdate, type AdminPayChannelKey,
} from './dto';

/**
 * 支付中心（A-20，M6.5）：跨租户订单查询/退款/关闭 + 支付渠道配置，仅平台管理员。
 * 退款/密钥等敏感操作全部落审计（A-13）。
 */
@Controller('admin/pay')
@Roles(RoleCode.PLATFORM_ADMIN)
export class AdminPayController {
  constructor(
    private readonly pay: AdminPayService,
    private readonly audit: AdminAuditService,
  ) {}

  /** 订单列表（跨租户） */
  @Get('orders')
  @HttpCode(HttpStatus.OK)
  listOrders(
    @Query('status') status?: string,
    @Query('channel') channel?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.pay.listOrders({
      status, channel, keyword, page: Number(page) || 1, pageSize: Number(pageSize) || 20,
    });
  }

  /** 退款（原因必填，订单 → REFUNDED + REFUND 负数流水 + 站内信） */
  @Post('orders/:orderNo/refund')
  @HttpCode(HttpStatus.OK)
  async refund(@Param('orderNo') orderNo: string, @Body(new ZodValidationPipe(AdminPayRefundSchema)) body: AdminPayRefund) {
    const res = await this.pay.refund(orderNo, body);
    await this.audit.record({ targetType: 'MEMBER_ORDER', targetId: orderNo, detail: { action: 'refund', reason: body.reason, transactionNo: res.transactionNo } });
    return res;
  }

  /** 关闭异常/超时订单 */
  @Post('orders/:orderNo/close')
  @HttpCode(HttpStatus.OK)
  async close(@Param('orderNo') orderNo: string) {
    const res = await this.pay.close(orderNo);
    await this.audit.record({ targetType: 'MEMBER_ORDER', targetId: orderNo, detail: { action: 'close' } });
    return res;
  }

  /** 渠道列表（密钥只回状态） */
  @Get('channels')
  @HttpCode(HttpStatus.OK)
  listChannels() {
    return this.pay.listChannels();
  }

  /** 编辑渠道（商户号/回调地址/启停） */
  @Put('channels/:id')
  @HttpCode(HttpStatus.OK)
  async updateChannel(@Param('id') id: string, @Body(new ZodValidationPipe(AdminPayChannelUpdateSchema)) body: AdminPayChannelUpdate) {
    const res = await this.pay.updateChannel(id, body);
    await this.audit.record({ targetType: 'PAY_CHANNEL', targetId: id, detail: { action: 'update', ...body } });
    return res;
  }

  /** 更新/轮换渠道密钥（AES-256-GCM 加密存储，只写不读） */
  @Post('channels/:id/key')
  @HttpCode(HttpStatus.OK)
  async updateChannelKey(@Param('id') id: string, @Body(new ZodValidationPipe(AdminPayChannelKeySchema)) body: AdminPayChannelKey) {
    const res = await this.pay.updateChannelKey(id, body);
    await this.audit.record({ targetType: 'PAY_CHANNEL', targetId: id, detail: { action: 'update-key' } });
    return res;
  }
}
