import { randomInt } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ErrorCode } from '@app/shared';
import { BizException } from '../../common/exceptions/biz.exception';

/**
 * 验证码/限流底层 KV 存储（Redis 实现 + 测试内存实现）。
 *incr 语义：自增并返回新值，键首次创建时设置 ttlSeconds。
 */
export interface SmsKvStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  incr(key: string, ttlSeconds: number): Promise<number>;
}

/** 防刷策略（可注入便于测试） */
export interface SmsPolicy {
  /** 重发冷却（秒） */
  cooldownSeconds: number;
  /** 验证码有效期（秒） */
  codeTtlSeconds: number;
  /** 单手机号每日发送上限 */
  phoneDailyLimit: number;
  /** 单 IP 每日发送上限 */
  ipDailyLimit: number;
  /** 单验证码最大尝试次数 */
  maxAttempts: number;
}

/** 默认策略：60s 冷却 / 5min 有效 / 手机号日 10 条 / IP 日 30 条 / 5 次尝试 */
export const DEFAULT_SMS_POLICY: SmsPolicy = {
  cooldownSeconds: 60,
  codeTtlSeconds: 5 * 60,
  phoneDailyLimit: 10,
  ipDailyLimit: 30,
  maxAttempts: 5,
};

/** 按天滚动的限流键后缀（如 20260826） */
function dayKey(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}${mm}${dd}`;
}

/**
 * 短信验证码服务：生成/校验验证码 + IP/手机号双维度防刷限流。
 * 存储通过 SmsKvStore 抽象，生产环境为 Redis，测试用内存实现。
 */
@Injectable()
export class SmsCodeService {
  private readonly logger = new Logger(SmsCodeService.name);

  constructor(
    private readonly store: SmsKvStore,
    private readonly policy: SmsPolicy = DEFAULT_SMS_POLICY,
  ) {}

  /**
   * 生成并发送验证码前的全部校验与写入（实际短信发送由调用方执行）。
   * @returns 生成的 6 位验证码
   */
  async issueCode(phone: string, ip: string): Promise<string> {
    const day = dayKey();
    // 限流键按天 TTL（25h 兜底，避免跨天临界误差）
    const dayTtl = 25 * 60 * 60;

    // 60s 冷却
    const cdKey = `sms:cd:${phone}`;
    if (await this.store.get(cdKey)) {
      throw new BizException(ErrorCode.SMS_CODE_TOO_FREQUENT, '发送过于频繁，请稍后再试', 429);
    }
    // 手机号日限
    const phoneCntKey = `sms:cnt:phone:${phone}:${day}`;
    if (Number((await this.store.get(phoneCntKey)) ?? 0) >= this.policy.phoneDailyLimit) {
      throw new BizException(ErrorCode.SMS_SEND_LIMIT_EXCEEDED, '今日该手机号发送次数已达上限', 429);
    }
    // IP 日限
    const ipCntKey = `sms:cnt:ip:${ip}:${day}`;
    if (Number((await this.store.get(ipCntKey)) ?? 0) >= this.policy.ipDailyLimit) {
      throw new BizException(ErrorCode.SMS_SEND_LIMIT_EXCEEDED, '今日发送次数已达上限', 429);
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.store.set(`sms:code:${phone}`, code, this.policy.codeTtlSeconds);
    await this.store.set(cdKey, '1', this.policy.cooldownSeconds);
    await this.store.incr(phoneCntKey, dayTtl);
    await this.store.incr(ipCntKey, dayTtl);

    this.logger.log(`验证码已生成: phone=***${phone.slice(-4)} ip=${ip}`);
    return code;
  }

  /** 校验验证码：超次/错误/过期均抛 SMS_CODE_INVALID，成功后立即销毁（一次性） */
  async verifyCode(phone: string, code: string): Promise<void> {
    const codeKey = `sms:code:${phone}`;
    const tryKey = `sms:try:${phone}`;

    const stored = await this.store.get(codeKey);
    if (!stored) {
      throw new BizException(ErrorCode.SMS_CODE_INVALID, '验证码错误或已过期', 401);
    }
    const attempts = Number((await this.store.get(tryKey)) ?? 0);
    if (attempts >= this.policy.maxAttempts) {
      await this.store.del(codeKey);
      await this.store.del(tryKey);
      throw new BizException(ErrorCode.SMS_CODE_INVALID, '尝试次数过多，请重新获取验证码', 401);
    }
    if (stored !== code) {
      await this.store.incr(tryKey, this.policy.codeTtlSeconds);
      throw new BizException(ErrorCode.SMS_CODE_INVALID, '验证码错误或已过期', 401);
    }
    await this.store.del(codeKey);
    await this.store.del(tryKey);
  }
}
