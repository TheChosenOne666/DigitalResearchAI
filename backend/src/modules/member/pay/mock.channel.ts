import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BizException } from '../../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import type {
  NotifyPayload,
  PayChannelAdapter,
  PrepayInput,
  VerifiedNotify,
} from './pay-channel';

/** 回调时间戳有效期：5 分钟（防重放） */
export const NOTIFY_TTL_MS = 5 * 60 * 1000;

/** MOCK 渠道收银台地址（前端页面路径，真实渠道为 code_url / qr_code） */
export const MOCK_CASHIER_PATH = '/pay/mock';

/**
 * 拼接待签名串：`orderNo|amountCents|transactionNo|timestamp`。
 * 纯函数，便于单测与真实渠道替换时对照。
 */
export function buildSignPayload(input: {
  orderNo: string;
  amountCents: number;
  transactionNo: string;
  timestamp: number;
}): string {
  return `${input.orderNo}|${input.amountCents}|${input.transactionNo}|${input.timestamp}`;
}

/** HMAC-SHA256 签名（hex） */
export function sign(raw: string, secret: string): string {
  return createHmac('sha256', secret).update(raw).digest('hex');
}

/**
 * 常量时间比较签名：长度不等先按长度差异返回 false，
 * 避免 timingSafeEqual 因 buffer 长度不同抛错。
 */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * MOCK 支付渠道（M5 D1）：开发/联调环境的模拟渠道。
 * 与真实渠道的差异仅在「签名算法」与「预支付参数形态」，
 * 下单 → 异步回调 → 幂等入账 的链路与真实渠道完全一致。
 */
@Injectable()
export class MockPayChannel implements PayChannelAdapter {
  readonly code = 'MOCK' as const;
  private readonly logger = new Logger(MockPayChannel.name);
  private readonly secret: string;
  private readonly webBaseUrl: string;

  constructor(config: ConfigService) {
    this.secret = config.get<string>('PAY_MOCK_SECRET', 'dev-mock-secret-change-me');
    this.webBaseUrl = config.get<string>('WEB_BASE_URL', 'http://localhost:5173');
    if (this.secret === 'dev-mock-secret-change-me') {
      this.logger.warn('PAY_MOCK_SECRET 使用默认值，生产环境请配置独立密钥');
    }
  }

  /** 预支付参数：返回前端 MOCK 收银台地址 */
  async createPrepay(input: PrepayInput): Promise<Record<string, unknown>> {
    const timestamp = Date.now();
    const transactionNo = `MOCK${timestamp}${randomBytes(3).toString('hex').toUpperCase()}`;
    const signValue = sign(
      buildSignPayload({ orderNo: input.orderNo, amountCents: input.amountCents, transactionNo, timestamp }),
      this.secret,
    );
    return {
      cashierUrl: `${this.webBaseUrl}${MOCK_CASHIER_PATH}?orderNo=${encodeURIComponent(input.orderNo)}&txn=${encodeURIComponent(transactionNo)}`,
      transactionNo,
      timestamp,
      sign: signValue,
      subject: input.subject,
      amountCents: input.amountCents,
    };
  }

  /** 校验回调签名：验签失败 / 超时 / 字段缺失 → 400 */
  async verifyNotify(payload: NotifyPayload): Promise<VerifiedNotify> {
    const { orderNo, transactionNo, amountCents, timestamp, sign: provided } = payload ?? ({} as NotifyPayload);
    if (!orderNo || !transactionNo || !provided) {
      throw new BizException(ErrorCode.PARAM_MISSING, '回调报文缺少必要字段', HttpStatus.BAD_REQUEST);
    }
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new BizException(ErrorCode.VALIDATION_FAILED, '回调金额非法', HttpStatus.BAD_REQUEST);
    }
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > NOTIFY_TTL_MS) {
      throw new BizException(ErrorCode.VALIDATION_FAILED, '回调报文已过期', HttpStatus.BAD_REQUEST);
    }
    const expected = sign(
      buildSignPayload({ orderNo, amountCents, transactionNo, timestamp }),
      this.secret,
    );
    if (!safeCompare(expected, provided)) {
      this.logger.warn(`MOCK 回调验签失败: orderNo=${orderNo} txn=${transactionNo}`);
      throw new BizException(ErrorCode.VALIDATION_FAILED, '回调签名校验失败', HttpStatus.BAD_REQUEST);
    }
    return { orderNo, transactionNo, amountCents };
  }

  /** 生成一次合法回调报文（开发联调/单测用，模拟渠道侧发起通知） */
  buildNotify(input: VerifiedNotify): NotifyPayload {
    const timestamp = Date.now();
    return {
      orderNo: input.orderNo,
      transactionNo: input.transactionNo,
      amountCents: input.amountCents,
      timestamp,
      sign: sign(
        buildSignPayload({
          orderNo: input.orderNo,
          amountCents: input.amountCents,
          transactionNo: input.transactionNo,
          timestamp,
        }),
        this.secret,
      ),
    };
  }
}
