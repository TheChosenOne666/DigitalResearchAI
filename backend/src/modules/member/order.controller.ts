import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { getTenantContext } from '../../common/auth/tenant-context';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import { OrderService } from './order.service';
import { PayService } from './pay/pay.service';
import type { PayChannel } from '../../generated/prisma/client';

/** 下单入参 */
export interface CreateOrderBody {
  planId?: unknown;
  channel?: unknown;
}

/** 发起支付入参 */
export interface PayBody {
  channel?: unknown;
}

/**
 * 会员订单控制器（M5.2）：下单 / 发起支付 / 取消 / 查单 / 待支付订单 / 模拟支付。
 * 路由顺序：`orders/pending` 需先于 `orders/:orderNo` 定义，避免被参数路由吞掉。
 */
@Controller('member/orders')
export class OrderController {
  constructor(
    private readonly orders: OrderService,
    private readonly payService: PayService,
  ) {}

  /** 当前用户 ID（受保护路由由全局守卫保证登录态） */
  private requireUserId(): string {
    const ctx = getTenantContext();
    if (!ctx) {
      throw new BizException(ErrorCode.UNAUTHORIZED, '未登录', HttpStatus.UNAUTHORIZED);
    }
    return ctx.userId;
  }

  /** 下单：选择套餐 → 生成待支付订单 */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() body: CreateOrderBody) {
    const planId = typeof body?.planId === 'string' ? body.planId : '';
    if (!planId) {
      throw new BizException(ErrorCode.PARAM_MISSING, '缺少套餐 ID', HttpStatus.BAD_REQUEST);
    }
    const channel = typeof body?.channel === 'string' ? (body.channel as PayChannel) : undefined;
    return this.orders.createOrder(this.requireUserId(), { planId, channel });
  }

  /** 我的订单列表 */
  @Get()
  @HttpCode(HttpStatus.OK)
  list(
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    return this.orders.list(this.requireUserId(), {
      status,
      keyword,
      page: Math.max(1, Number(page) || 1),
      pageSize: Math.min(100, Math.max(1, Number(pageSize) || 20)),
    });
  }

  /** 待支付订单（支付中心顶部卡片；触发到期懒续费） */
  @Get('pending')
  @HttpCode(HttpStatus.OK)
  pending() {
    return this.orders.pendingOrder(this.requireUserId());
  }

  /** 发起支付：返回渠道预支付参数（MOCK 为收银台地址） */
  @Post(':orderNo/pay')
  @HttpCode(HttpStatus.OK)
  pay(@Param('orderNo') orderNo: string, @Body() body: PayBody) {
    const channel = typeof body?.channel === 'string' ? (body.channel as PayChannel) : undefined;
    return this.orders.pay(this.requireUserId(), orderNo, channel);
  }

  /** 取消订单（仅待支付可取消） */
  @Post(':orderNo/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('orderNo') orderNo: string) {
    return this.orders.cancel(this.requireUserId(), orderNo);
  }

  /**
   * 开发联调：模拟渠道支付成功回调（服务端自签名后走真实回调链路）。
   * 生产环境该入口应关闭（或限制为测试账号）。
   */
  @Post(':orderNo/mock-pay')
  @HttpCode(HttpStatus.OK)
  mockPay(@Param('orderNo') orderNo: string) {
    return this.payService.mockPay(orderNo, this.requireUserId());
  }

  /** 订单详情（前端支付后轮询查单） */
  @Get(':orderNo')
  @HttpCode(HttpStatus.OK)
  detail(@Param('orderNo') orderNo: string) {
    return this.orders.detail(this.requireUserId(), orderNo);
  }
}
