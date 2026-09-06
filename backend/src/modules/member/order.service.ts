import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import type { OrderStatus, PayChannel } from '../../generated/prisma/client';
import { PlanStoreService } from './plan.store.service';
import { OrderStoreService } from './order.store.service';
import { SubscriptionStoreService } from './subscription.store.service';
import { isMemberEffective } from './subscription';
import { CYCLE_NAMES, LEVEL_NAMES } from './plans';
import { PayChannelRegistry } from './pay/pay-channel';

/** 订单支付有效期：30 分钟 */
export const ORDER_PAY_TTL_MS = 30 * 60 * 1000;

/** 订单对外形状（隐藏内部字段，附带展示用文案） */
export interface OrderView {
  id: string;
  orderNo: string;
  planName: string;
  level: string;
  levelName: string;
  cycle: string;
  cycleName: string;
  amountCents: number;
  amount: number;
  channel: PayChannel;
  channelName: string;
  status: OrderStatus;
  statusName: string;
  periodStart: string | null;
  periodEnd: string | null;
  payInfo: unknown;
  paidAt: string | null;
  expireAt: string | null;
  isRenewal: boolean;
  createdAt: string;
}

/** 订单状态中文名 */
const STATUS_NAMES: Record<OrderStatus, string> = {
  PENDING: '待支付',
  PAID: '已支付',
  CANCELLED: '已取消',
  CLOSED: '已关闭',
  FAILED: '回调异常',
  REFUNDED: '已退款',
};

/** 支付渠道中文名 */
const CHANNEL_NAMES: Record<PayChannel, string> = {
  MOCK: '模拟支付',
  WECHAT: '微信支付',
  ALIPAY: '支付宝',
};

/** 生成业务订单号：ORD + yyyyMMddHHmmss + 4 位随机 */
export function generateOrderNo(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `ORD${stamp}${String(randomInt(0, 10000)).padStart(4, '0')}`;
}

/**
 * 会员订单服务（M5.2）：下单 / 发起支付 / 取消 / 查单 / 到期懒续费。
 * 状态机：PENDING →(支付成功) PAID（终态）；PENDING → CANCELLED / CLOSED / FAILED。
 */
@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly planStore: PlanStoreService,
    private readonly orderStore: OrderStoreService,
    private readonly subscriptionStore: SubscriptionStoreService,
    private readonly registry: PayChannelRegistry,
  ) {}

  /**
   * 下单：校验套餐 → 生成订单号 → 落库（PENDING，30 分钟支付有效期）。
   * @param channel 支付渠道，默认 MOCK（当前仅注册 MOCK）
   */
  async createOrder(
    userId: string,
    input: { planId: string; channel?: PayChannel },
  ): Promise<OrderView> {
    const plan = await this.planStore.getPlan(input.planId);
    if (!plan) {
      throw new BizException(ErrorCode.NOT_FOUND, '套餐不存在或已下架', HttpStatus.NOT_FOUND);
    }
    const channel: PayChannel = input.channel ?? 'MOCK';
    const now = new Date();
    const order = await this.orderStore.createOrder({
      userId,
      orderNo: generateOrderNo(now),
      plan,
      channel,
      expireAt: new Date(now.getTime() + ORDER_PAY_TTL_MS),
    });
    this.logger.log(`订单已创建: orderNo=${order.orderNo} userId=${userId} 套餐=${plan.name}`);
    return toOrderView(order);
  }

  /**
   * 发起支付：校验归属与状态 → 生成渠道预支付参数（payInfo）。
   * 订单已过期（超过支付有效期）→ 置为 CLOSED 并报错。
   */
  async pay(
    userId: string,
    orderNo: string,
    channel?: PayChannel,
  ): Promise<{ order: OrderView; payInfo: Record<string, unknown> }> {
    const order = await this.requireOwnOrder(userId, orderNo);
    if (order.status === 'CLOSED' || (order.expireAt && order.expireAt.getTime() < Date.now())) {
      await this.orderStore.updateOrderStatus(order.id, ['PENDING'], 'CLOSED');
      throw new BizException(ErrorCode.CONFLICT, '订单已超时关闭，请重新下单', HttpStatus.CONFLICT);
    }
    if (order.status !== 'PENDING') {
      throw new BizException(ErrorCode.CONFLICT, `订单当前状态不可支付：${STATUS_NAMES[order.status]}`, HttpStatus.CONFLICT);
    }
    const payChannel: PayChannel = channel ?? order.channel;
    const payInfo = await this.registry.get(payChannel).createPrepay({
      orderNo: order.orderNo,
      amountCents: order.amountCents,
      subject: readPlanName(order.planSnapshot),
    });
    await this.orderStore.attachPayInfo(order.id, payChannel, payInfo);
    const refreshed = await this.orderStore.getOrderByNo(orderNo);
    return { order: toOrderView(refreshed), payInfo };
  }

  /** 取消订单（仅 PENDING 可取消；已取消重复调用幂等成功） */
  async cancel(userId: string, orderNo: string): Promise<OrderView> {
    const order = await this.requireOwnOrder(userId, orderNo);
    if (order.status === 'CANCELLED') return toOrderView(order);
    if (order.status !== 'PENDING') {
      throw new BizException(ErrorCode.CONFLICT, `订单当前状态不可取消：${STATUS_NAMES[order.status]}`, HttpStatus.CONFLICT);
    }
    const ok = await this.orderStore.updateOrderStatus(order.id, ['PENDING'], 'CANCELLED');
    if (!ok) {
      throw new BizException(ErrorCode.CONFLICT, '订单状态已变更，请刷新后重试', HttpStatus.CONFLICT);
    }
    this.logger.log(`订单已取消: orderNo=${orderNo}`);
    return toOrderView(await this.orderStore.getOrderByNo(orderNo));
  }

  /** 订单详情（归属校验） */
  async detail(userId: string, orderNo: string): Promise<OrderView> {
    return toOrderView(await this.requireOwnOrder(userId, orderNo));
  }

  /** 我的订单列表（账单页可按下单时间下界筛选） */
  async list(
    userId: string,
    query: { status?: string; keyword?: string; from?: Date; page: number; pageSize: number },
  ): Promise<{ list: OrderView[]; total: number; page: number; pageSize: number }> {
    const status = normalizeStatus(query.status);
    const { list, total } = await this.orderStore.listOrders({
      userId,
      ...(status ? { status } : {}),
      ...(query.from ? { from: query.from } : {}),
      keyword: query.keyword,
      page: query.page,
      pageSize: query.pageSize,
    });
    return { list: list.map(toOrderView), total, page: query.page, pageSize: query.pageSize };
  }

  /**
   * 待支付订单（支付中心顶部卡片）。
   * 同时承担「到期懒续费」（M5 D2）：连续包月用户会员已过期时，
   * 按原等级/周期自动生成下一期待支付订单（同周期仅生成一次）。
   */
  async pendingOrder(userId: string): Promise<OrderView | null> {
    await this.renewIfNeeded(userId);
    const order = await this.orderStore.findPendingOrder(userId);
    return order ? toOrderView(order) : null;
  }

  /**
   * 到期懒续费：autoRenew 开启 + 会员已过期 + 无待支付续费单 → 生成续费订单。
   * 幂等依赖 findPendingOrder 的查重（同一周期内不会重复建单）。
   */
  private async renewIfNeeded(userId: string): Promise<void> {
    const existing = await this.orderStore.findPendingOrder(userId);
    if (existing) return;
    const sub = await this.subscriptionStore.getSubscription(userId);
    if (!sub || !sub.autoRenew || !sub.cycle || sub.level === 'FREE') return;
    if (isMemberEffective(sub, new Date())) return;

    const plan = await this.planStore.findPlan(sub.level, sub.cycle);
    if (!plan) {
      this.logger.warn(`懒续费跳过：未找到套餐 level=${sub.level} cycle=${sub.cycle}`);
      return;
    }
    const now = new Date();
    // 生效区间在支付回调入账时按 calcPeriodBase 计算（下单不锁定到期日）
    const order = await this.orderStore.createOrder({
      userId,
      orderNo: generateOrderNo(now),
      plan,
      channel: 'MOCK',
      expireAt: new Date(now.getTime() + ORDER_PAY_TTL_MS),
      isRenewal: true,
    });
    this.logger.log(`已生成续费订单: orderNo=${order.orderNo} userId=${userId} 周期=${CYCLE_NAMES[sub.cycle]}`);
  }

  /** 取订单并校验归属（跨用户 → 404，避免信息泄漏） */
  private async requireOwnOrder(userId: string, orderNo: string) {
    const order = await this.orderStore.getOrderByNo(orderNo);
    if (order.userId !== userId) {
      throw new BizException(ErrorCode.NOT_FOUND, '订单不存在', HttpStatus.NOT_FOUND);
    }
    return order;
  }
}

/** 读订单套餐快照名称（下单时固化，用于渠道商品描述） */
function readPlanName(snapshot: unknown): string {
  if (snapshot && typeof snapshot === 'object') {
    const name = (snapshot as Record<string, unknown>).name;
    if (typeof name === 'string' && name.length > 0) return name;
  }
  return '会员套餐';
}

/** 状态参数归一化（非法值忽略） */
function normalizeStatus(raw?: string): OrderStatus | undefined {
  if (!raw) return undefined;
  const upper = raw.toUpperCase();
  if (upper === 'PENDING' || upper === 'PAID' || upper === 'CANCELLED' || upper === 'CLOSED' || upper === 'FAILED') {
    return upper as OrderStatus;
  }
  return undefined;
}

/** 订单行 → 对外视图（附带展示文案与金额换算） */
function toOrderView(order: {
  id: string;
  orderNo: string;
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
}): OrderView {
  const snap = (order.planSnapshot ?? {}) as Record<string, unknown>;
  const level = (snap.level as 'PRO' | 'ENTERPRISE') ?? 'PRO';
  const cycle = (snap.cycle as 'SINGLE' | 'MONTHLY' | 'YEAR') ?? 'MONTHLY';
  return {
    id: order.id,
    orderNo: order.orderNo,
    planName: readPlanName(order.planSnapshot),
    level,
    levelName: LEVEL_NAMES[level],
    cycle,
    cycleName: CYCLE_NAMES[cycle],
    amountCents: order.amountCents,
    amount: order.amountCents / 100,
    channel: order.channel,
    channelName: CHANNEL_NAMES[order.channel],
    status: order.status,
    statusName: STATUS_NAMES[order.status],
    periodStart: order.periodStart?.toISOString() ?? null,
    periodEnd: order.periodEnd?.toISOString() ?? null,
    payInfo: order.payInfo,
    paidAt: order.paidAt?.toISOString() ?? null,
    expireAt: order.expireAt?.toISOString() ?? null,
    isRenewal: order.isRenewal,
    createdAt: order.createdAt.toISOString(),
  };
}

