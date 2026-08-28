import type { PayChannel } from '../../../generated/prisma/client';

/** 下单预支付入参 */
export interface PrepayInput {
  /** 业务订单号 */
  orderNo: string;
  /** 金额（分） */
  amountCents: number;
  /** 商品描述（如「专业版 · 年付」） */
  subject: string;
}

/** 渠道回调报文（各渠道字段不同，统一收敛为这四个 + 原始报文） */
export interface NotifyPayload {
  /** 业务订单号 */
  orderNo: string;
  /** 渠道流水号（幂等键） */
  transactionNo: string;
  /** 金额（分） */
  amountCents: number;
  /** 回调时间戳（毫秒），用于防重放 */
  timestamp: number;
  /** 签名 */
  sign: string;
}

/** 验签通过后的回调内容 */
export interface VerifiedNotify {
  orderNo: string;
  transactionNo: string;
  amountCents: number;
}

/**
 * 支付渠道适配器（M5 D1）：微信/支付宝/MOCK 统一抽象。
 * 真实渠道接入时只需实现本接口并注册到 PayChannelRegistry，业务代码零改动。
 */
export interface PayChannelAdapter {
  /** 渠道编码 */
  readonly code: PayChannel;
  /** 生成预支付参数（微信为 code_url、支付宝为 qr_code，MOCK 为收银台地址） */
  createPrepay(input: PrepayInput): Promise<Record<string, unknown>>;
  /** 校验回调报文签名，失败抛 BizException；返回验签后的关键字段 */
  verifyNotify(payload: NotifyPayload): Promise<VerifiedNotify>;
  /** 生成一次回调报文（开发联调用；真实渠道由平台回调触发，无需实现） */
  buildNotify?(input: VerifiedNotify): NotifyPayload;
}

/**
 * 渠道注册表：按渠道编码取适配器。
 * 目前仅注册 MOCK；接入微信/支付宝时在 module providers 追加即可。
 */
export class PayChannelRegistry {
  private readonly adapters = new Map<PayChannel, PayChannelAdapter>();

  constructor(adapters: PayChannelAdapter[]) {
    for (const a of adapters) this.adapters.set(a.code, a);
  }

  /** 取适配器（未注册的渠道 → 400 参数错误） */
  get(code: string): PayChannelAdapter {
    const adapter = this.adapters.get(code as PayChannel);
    if (!adapter) {
      throw new Error(`不支持的支付渠道: ${code}`);
    }
    return adapter;
  }
}
