import { Controller, Get, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { getTenantContext } from '../../common/auth/tenant-context';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import { OrderService } from './order.service';
import { MemberStoreService } from './member.store.service';

/** 账单时间范围：全部 / 近 30 天 / 近 90 天 */
const RANGE_DAYS: Record<string, number> = { '30d': 30, '90d': 90 };

/**
 * 账单控制器（M5.2）：订单列表 + 支付流水（原型「账单查询」双页签）。
 */
@Controller('billing')
export class BillingController {
  constructor(
    private readonly orders: OrderService,
    private readonly store: MemberStoreService,
  ) {}

  /** 当前用户 ID（受保护路由由全局守卫保证登录态） */
  private requireUserId(): string {
    const ctx = getTenantContext();
    if (!ctx) {
      throw new BizException(ErrorCode.UNAUTHORIZED, '未登录', HttpStatus.UNAUTHORIZED);
    }
    return ctx.userId;
  }

  /** 订单列表（时间范围 + 状态筛选 + 分页） */
  @Get('orders')
  @HttpCode(HttpStatus.OK)
  listOrders(
    @Query('range') range?: string,
    @Query('status') status?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const days = range ? RANGE_DAYS[range] : undefined;
    const from = days ? new Date(Date.now() - days * 86_400_000) : undefined;
    return this.orders.list(this.requireUserId(), {
      status,
      from,
      page: Math.max(1, Number(page) || 1),
      pageSize: Math.min(100, Math.max(1, Number(pageSize) || 20)),
    });
  }

  /** 支付流水列表（分页） */
  @Get('payments')
  @HttpCode(HttpStatus.OK)
  listPayments(@Query('page') page = '1', @Query('pageSize') pageSize = '20') {
    const p = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(1, Number(pageSize) || 20));
    return this.store.listPayments({ userId: this.requireUserId(), page: p, pageSize: size }).then((res) => ({
      ...res,
      page: p,
      pageSize: size,
    }));
  }
}
