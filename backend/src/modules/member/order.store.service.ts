import { HttpStatus, Injectable } from '@nestjs/common';
import { getTenantContext } from '../../common/auth/tenant-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import type { MemberOrder, OrderStatus, PayChannel } from '../../generated/prisma/client';
import { Prisma } from '../../generated/prisma/client';
import type { MemberLevel, PlanCycle } from '../../generated/prisma/client';
import type { PlanRow } from './plan.store.service';

/** 订单行（含套餐快照） */
export interface OrderRow {
  id: string;
  userId: string;
  orderNo: string;
  planId: string;
  planSnapshot: unknown;
  amountCents: number;
  channel: PayChannel;
  status: OrderStatus;
  periodStart: Date | null;
  periodEnd: Date | null;
  payInfo: unknown;
  paidAt: Date | null;
  expireAt: Date | null;
  isRenewal: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 订单与支付流水持久化（M5.2）：租户级数据（经 forTenant 强制注入 tenant_id），
 * 支付回调链路无登录态的系统态方法（*System 后缀）显式传 tenantId 走系统 client。
 * settlePayment 为支付幂等落账事务核心，状态机守卫 + 三步同事务。
 */
@Injectable()
export class OrderStoreService {
  constructor(private readonly prisma: PrismaService) {}

  /** 当前请求租户上下文（受保护路由由拦截器注入；缺失视为未授权） */
  private requireTenant(): { tenantId: string } {
    const ctx = getTenantContext();
    if (!ctx) {
      throw new BizException(ErrorCode.UNAUTHORIZED, '缺少租户上下文', HttpStatus.UNAUTHORIZED);
    }
    return { tenantId: ctx.tenantId };
  }

  // ===== 订单 =====

  /** 订单号唯一查询（跨租户/不存在 → 404） */
  async getOrderByNo(orderNo: string): Promise<OrderRow> {
    const r = await this.prisma.forTenant.memberOrder.findFirst({ where: { orderNo } });
    if (!r) {
      throw new BizException(ErrorCode.NOT_FOUND, '订单不存在', HttpStatus.NOT_FOUND);
    }
    return toOrderRow(r);
  }

  /** 当前用户最近的待支付订单（支付中心顶部卡片） */
  async findPendingOrder(userId: string): Promise<OrderRow | null> {
    const r = await this.prisma.forTenant.memberOrder.findFirst({
      where: { userId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    return r ? toOrderRow(r) : null;
  }

  /** 我的订单列表（时间范围/状态/关键词筛选 + 分页） */
  async listOrders(query: {
    userId: string;
    status?: OrderStatus;
    keyword?: string;
    /** 下单时间下界（账单页时间筛选） */
    from?: Date;
    page: number;
    pageSize: number;
  }): Promise<{ list: OrderRow[]; total: number }> {
    const { userId, status, keyword, from, page, pageSize } = query;
    const kw = keyword?.trim();
    const rows = await this.prisma.forTenant.memberOrder.findMany({
      where: {
        userId,
        ...(status ? { status } : {}),
        ...(from ? { createdAt: { gte: from } } : {}),
        ...(kw ? { orderNo: { contains: kw } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    const total = rows.length;
    const skip = Math.max(0, (page - 1) * pageSize);
    return { list: rows.slice(skip, skip + pageSize).map(toOrderRow), total };
  }

  /** 创建订单（下单用），返回订单行 */
  async createOrder(input: {
    userId: string;
    orderNo: string;
    plan: PlanRow;
    channel: PayChannel;
    expireAt: Date;
    isRenewal?: boolean;
  }): Promise<OrderRow> {
    const { tenantId } = this.requireTenant();
    const snapshot = {
      code: input.plan.code,
      name: input.plan.name,
      level: input.plan.level,
      cycle: input.plan.cycle,
      priceCents: input.plan.priceCents,
    };
    const r = await this.prisma.forTenant.memberOrder.create({
      data: {
        tenantId,
        userId: input.userId,
        orderNo: input.orderNo,
        planId: input.plan.id,
        planSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        amountCents: input.plan.priceCents,
        channel: input.channel,
        expireAt: input.expireAt,
        isRenewal: input.isRenewal ?? false,
      },
    });
    return toOrderRow(r);
  }

  /**
   * 状态机推进（幂等核心）：仅当订单处于 from 状态时更新为 to，
   * 通过 updateMany 的 count 判定是否被并发请求抢先（0 行 → 已被处理）。
   */
  async updateOrderStatus(
    id: string,
    from: OrderStatus[],
    to: OrderStatus,
    data: Record<string, unknown> = {},
  ): Promise<boolean> {
    const res = await this.prisma.forTenant.memberOrder.updateMany({
      where: { id, status: { in: from } },
      data: { status: to, ...data } as Prisma.MemberOrderUpdateManyMutationInput,
    });
    return res.count > 0;
  }

  /** 挂载渠道预支付参数（发起支付时回写 payInfo + 渠道） */
  async attachPayInfo(id: string, channel: PayChannel, payInfo: unknown): Promise<void> {
    await this.prisma.forTenant.memberOrder.update({
      where: { id },
      data: { channel, payInfo: payInfo as Prisma.InputJsonValue },
    });
  }

  /** 直接按 id 取订单（回调入账用，不加状态条件） */
  async getOrderById(id: string): Promise<OrderRow | null> {
    const r = await this.prisma.forTenant.memberOrder.findFirst({ where: { id } });
    return r ? toOrderRow(r) : null;
  }

  /** 按订单号查订单（系统上下文，回调链路无登录态，按 orderNo 直查） */
  async getOrderByNoSystem(orderNo: string): Promise<MemberOrder | null> {
    return this.prisma.memberOrder.findFirst({ where: { orderNo } });
  }

  // ===== 支付流水 =====

  /**
   * 按渠道流水号查流水（幂等判定，系统上下文）。
   * transactionNo 全局唯一，回调链路无租户上下文，故走系统 client 直查。
   */
  async findPaymentByTxn(transactionNo: string): Promise<{ id: string; orderId: string; status: string } | null> {
    const r = await this.prisma.paymentRecord.findFirst({ where: { transactionNo } });
    return r ? { id: r.id, orderId: r.orderId, status: r.status } : null;
  }

  /** 写支付流水（回调落账，transactionNo 唯一约束兜底并发） */
  async createPayment(input: {
    orderId: string;
    orderNo: string;
    transactionNo: string;
    channel: PayChannel;
    amountCents: number;
    status: 'SUCCESS' | 'FAILED';
    rawPayload: unknown;
  }): Promise<void> {
    const { tenantId } = this.requireTenant();
    await this.prisma.forTenant.paymentRecord.create({
      data: {
        tenantId,
        orderId: input.orderId,
        orderNo: input.orderNo,
        transactionNo: input.transactionNo,
        channel: input.channel,
        amountCents: input.amountCents,
        status: input.status,
        rawPayload: input.rawPayload as Prisma.InputJsonValue,
      },
    });
  }

  /** 写支付流水（系统上下文，显式 tenantId；成功流水在 settlePayment 事务内写入） */
  async createPaymentSystem(
    tenantId: string,
    input: {
      orderId: string;
      orderNo: string;
      transactionNo: string;
      channel: PayChannel;
      amountCents: number;
      status: 'SUCCESS' | 'FAILED';
      rawPayload: unknown;
    },
  ): Promise<void> {
    await this.prisma.paymentRecord.create({
      data: {
        tenantId,
        orderId: input.orderId,
        orderNo: input.orderNo,
        transactionNo: input.transactionNo,
        channel: input.channel,
        amountCents: input.amountCents,
        status: input.status,
        rawPayload: input.rawPayload as Prisma.InputJsonValue,
      },
    });
  }

  /** 支付流水列表（账单页） */
  async listPayments(query: {
    userId: string;
    page: number;
    pageSize: number;
  }): Promise<{ list: Array<Record<string, unknown>>; total: number }> {
    const { userId, page, pageSize } = query;
    // 流水与订单无物理外键，先取本用户订单号再按 orderId 过滤
    const myOrders = await this.prisma.forTenant.memberOrder.findMany({
      where: { userId },
      select: { id: true },
    });
    const orderIds = myOrders.map((o) => o.id);
    const rows = await this.prisma.forTenant.paymentRecord.findMany({
      where: { orderId: { in: orderIds } },
      orderBy: { createdAt: 'desc' },
    });
    const total = rows.length;
    const skip = Math.max(0, (page - 1) * pageSize);
    return {
      list: rows.slice(skip, skip + pageSize).map((r) => ({
        id: r.id,
        transactionNo: r.transactionNo,
        channel: r.channel,
        orderId: r.orderId,
        orderNo: r.orderNo,
        amountCents: r.amountCents,
        amount: r.amountCents / 100,
        status: r.status,
        paidAt: r.paidAt,
      })),
      total,
    };
  }

  /**
   * 支付入账事务（回调核心，M5.2 幂等关键点）：
   * 订单 PENDING → PAID（状态机守卫）→ 写成功流水 → 会员生效/续期，三步同一事务。
   * @returns true 入账成功；false 表示订单已被其他并发请求处理（幂等短路，不重复入账）
   */
  async settlePayment(input: {
    order: MemberOrder;
    periodStart: Date;
    periodEnd: Date;
    transactionNo: string;
    channel: PayChannel;
    rawPayload: unknown;
    paidAt: Date;
  }): Promise<boolean> {
    const { order } = input;
    const { level, cycle } = readPlanSnapshot(order.planSnapshot);
    return this.prisma.$transaction(async (tx) => {
      // 状态机守卫：仅 PENDING 可推进，并发下靠影响行数判定是否被抢先
      const res = await tx.memberOrder.updateMany({
        where: { id: order.id, status: 'PENDING' },
        data: {
          status: 'PAID',
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          paidAt: input.paidAt,
        },
      });
      if (res.count === 0) return false;
      await tx.paymentRecord.create({
        data: {
          tenantId: order.tenantId,
          orderId: order.id,
          orderNo: order.orderNo,
          transactionNo: input.transactionNo,
          channel: input.channel,
          amountCents: order.amountCents,
          status: 'SUCCESS',
          rawPayload: input.rawPayload as Prisma.InputJsonValue,
        },
      });
      await tx.memberSubscription.upsert({
        where: { userId: order.userId },
        create: {
          tenantId: order.tenantId,
          userId: order.userId,
          level,
          cycle,
          expireAt: input.periodEnd,
          totalPeriods: 1,
        },
        update: {
          level,
          cycle,
          expireAt: input.periodEnd,
          totalPeriods: { increment: 1 },
        },
      });
      return true;
    });
  }
}

/** 订单套餐快照解析（下单时固化等级/周期；异常数据回退 PRO/MONTHLY） */
function readPlanSnapshot(snapshot: unknown): { level: MemberLevel; cycle: PlanCycle } {
  if (snapshot && typeof snapshot === 'object') {
    const s = snapshot as Record<string, unknown>;
    const level = s.level;
    const cycle = s.cycle;
    return {
      level: level === 'PRO' || level === 'ENTERPRISE' ? level : 'PRO',
      cycle: cycle === 'SINGLE' || cycle === 'MONTHLY' || cycle === 'YEAR' ? cycle : 'MONTHLY',
    };
  }
  return { level: 'PRO', cycle: 'MONTHLY' };
}

/** 订单行转换（统一对外形状） */
function toOrderRow(r: MemberOrder): OrderRow {
  return {
    id: r.id,
    userId: r.userId,
    orderNo: r.orderNo,
    planId: r.planId,
    planSnapshot: r.planSnapshot,
    amountCents: r.amountCents,
    channel: r.channel,
    status: r.status,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    payInfo: r.payInfo,
    paidAt: r.paidAt,
    expireAt: r.expireAt,
    isRenewal: r.isRenewal,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
