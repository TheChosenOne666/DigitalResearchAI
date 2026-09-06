import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { PayChannel } from '../../../generated/prisma/client';
import { BizException } from '../../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import { OrderStoreService } from '../order.store.service';
import { SubscriptionStoreService } from '../subscription.store.service';
import { calcPeriodBase, calcPeriodEnd, endOfDay } from '../subscription';
import { PayChannelRegistry } from './pay-channel';
import type { NotifyPayload, PayChannelAdapter } from './pay-channel';

/** 回调处理结果 */
export interface NotifyResult {
  /** 是否处理成功（含幂等命中） */
  ok: boolean;
  /** 幂等命中：该流水号此前已入账，本次未重复入账 */
  duplicate?: boolean;
  /** 失败原因（ok=false 时） */
  reason?: 'AMOUNT_MISMATCH' | 'ORDER_NOT_PENDING';
  /** 生效的会员区间（入账成功时） */
  periodStart?: string;
  periodEnd?: string;
}

/**
 * 支付回调编排（M5.2 核心）：验签 → 幂等 → 事务入账 → 会员生效。
 * 真实渠道与 MOCK 共用同一条入账路径，保证幂等逻辑在两种渠道下一致。
 */
@Injectable()
export class PayService {
  private readonly logger = new Logger(PayService.name);

  constructor(
    private readonly orderStore: OrderStoreService,
    private readonly subscriptionStore: SubscriptionStoreService,
    private readonly registry: PayChannelRegistry,
  ) {}

  /**
   * 处理渠道回调。
   * - 验签失败 → 抛 400（不落任何数据）
   * - 流水号已存在 → 幂等返回成功，不重复入账
   * - 金额不符 / 订单非待支付 → 记 FAILED 流水，返回失败（不改动订单）
   * - 正常 → 事务内 订单置 PAID + 写成功流水 + 会员生效
   */
  async handleNotify(channelCode: string, payload: NotifyPayload): Promise<NotifyResult> {
    // 渠道名大小写不敏感：回调路径 /pay/notify/wechat 与 /pay/notify/WECHAT 等价
    const normalized = String(channelCode ?? '').toUpperCase();
    let adapter: PayChannelAdapter;
    try {
      adapter = this.registry.get(normalized);
    } catch {
      throw new BizException(ErrorCode.PARAM_MISSING, `不支持的支付渠道: ${channelCode}`, HttpStatus.BAD_REQUEST);
    }

    // 1) 验签（失败直接抛 400，不落库）
    const verified = await adapter.verifyNotify(payload);

    // 2) 流水号幂等：同一 transactionNo 只入账一次
    const existed = await this.orderStore.findPaymentByTxn(verified.transactionNo);
    if (existed) {
      this.logger.log(`回调重复命中（流水已存在）: txn=${verified.transactionNo} status=${existed.status}`);
      return { ok: true, duplicate: true };
    }

    // 3) 查订单（系统上下文：回调无登录态，订单号全局唯一）
    const order = await this.orderStore.getOrderByNoSystem(verified.orderNo);
    if (!order) {
      throw new BizException(ErrorCode.NOT_FOUND, '订单不存在', HttpStatus.NOT_FOUND);
    }

    // 4) 金额校验：与下单金额不一致视为异常回调
    if (order.amountCents !== verified.amountCents) {
      await this.orderStore.createPaymentSystem(order.tenantId, {
        orderId: order.id,
        orderNo: order.orderNo,
        transactionNo: verified.transactionNo,
        channel: order.channel,
        amountCents: verified.amountCents,
        status: 'FAILED',
        rawPayload: { ...payload, failReason: 'AMOUNT_MISMATCH' },
      });
      this.logger.warn(
        `回调金额不符: orderNo=${order.orderNo} 期望=${order.amountCents} 回调=${verified.amountCents}`,
      );
      return { ok: false, reason: 'AMOUNT_MISMATCH' };
    }

    // 5) 状态机守卫：仅 PENDING 可入账
    if (order.status !== 'PENDING') {
      await this.orderStore.createPaymentSystem(order.tenantId, {
        orderId: order.id,
        orderNo: order.orderNo,
        transactionNo: verified.transactionNo,
        channel: order.channel,
        amountCents: verified.amountCents,
        status: 'FAILED',
        rawPayload: { ...payload, failReason: 'ORDER_NOT_PENDING' },
      });
      this.logger.warn(`回调时订单非待支付: orderNo=${order.orderNo} status=${order.status}`);
      return { ok: false, reason: 'ORDER_NOT_PENDING' };
    }

    // 6) 计算生效区间：同等级续费在原到期日累加，跨等级/新开从当前时间起算
    const sub = await this.subscriptionStore.getSubscriptionSystem(order.userId);
    const now = new Date();
    const snapshot = readLevel(order.planSnapshot);
    const base = calcPeriodBase(sub, snapshot.level, now);
    const periodEnd = endOfDay(calcPeriodEnd(base, snapshot.cycle));

    // 7) 事务入账（并发下由 updateMany 守卫，false 表示已被抢先处理）
    const settled = await this.orderStore.settlePayment({
      order,
      periodStart: base,
      periodEnd,
      transactionNo: verified.transactionNo,
      channel: order.channel,
      rawPayload: payload,
      paidAt: now,
    });
    if (!settled) {
      this.logger.log(`回调并发命中（订单已被处理）: orderNo=${order.orderNo}`);
      return { ok: true, duplicate: true };
    }

    this.logger.log(
      `支付入账成功: orderNo=${order.orderNo} 金额=${order.amountCents}分 会员到期=${periodEnd.toISOString()}`,
    );
    return {
      ok: true,
      periodStart: base.toISOString(),
      periodEnd: periodEnd.toISOString(),
    };
  }

  /**
   * 开发联调：模拟渠道发起一次支付成功回调（服务端自签名，前端无法伪造）。
   * 与真实渠道回调走同一 handleNotify 路径。
   */
  async mockPay(orderNo: string, userId: string): Promise<NotifyResult> {
    const order = await this.orderStore.getOrderByNoSystem(orderNo);
    if (!order) {
      throw new BizException(ErrorCode.NOT_FOUND, '订单不存在', HttpStatus.NOT_FOUND);
    }
    if (order.userId !== userId) {
      throw new BizException(ErrorCode.FORBIDDEN, '无权操作他人订单', HttpStatus.FORBIDDEN);
    }
    if (order.status !== 'PENDING') {
      throw new BizException(ErrorCode.CONFLICT, '订单当前状态不可支付', HttpStatus.CONFLICT);
    }
    const adapter = this.registry.get(order.channel);
    if (!adapter.buildNotify) {
      throw new BizException(ErrorCode.VALIDATION_FAILED, '该渠道不支持模拟支付', HttpStatus.BAD_REQUEST);
    }
    const payload = adapter.buildNotify({
      orderNo: order.orderNo,
      transactionNo: `MOCK${Date.now()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      amountCents: order.amountCents,
    });
    return this.handleNotify(order.channel, payload as NotifyPayload & { channel?: PayChannel });
  }
}

/** 订单快照等级/周期解析（与 store 侧保持一致） */
function readLevel(snapshot: unknown): { level: 'FREE' | 'PRO' | 'ENTERPRISE'; cycle: 'SINGLE' | 'MONTHLY' | 'YEAR' } {
  if (snapshot && typeof snapshot === 'object') {
    const s = snapshot as Record<string, unknown>;
    return {
      level: (s.level as 'PRO' | 'ENTERPRISE') ?? 'PRO',
      cycle: (s.cycle as 'SINGLE' | 'MONTHLY' | 'YEAR') ?? 'MONTHLY',
    };
  }
  return { level: 'PRO', cycle: 'MONTHLY' };
}
