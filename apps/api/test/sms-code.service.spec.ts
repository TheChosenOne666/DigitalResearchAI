import { describe, expect, it, beforeEach } from 'vitest';
import { ErrorCode } from '@app/shared';
import {
  SmsCodeService,
  SmsKvStore,
  SmsPolicy,
} from '../src/modules/auth/sms-code.service';

/** 测试用内存 KV：支持 TTL 过期（时间戳判定，不依赖真实时钟等待） */
class MemoryKvStore implements SmsKvStore {
  private data = new Map<string, { value: string; expiresAt: number }>();

  private alive(key: string): { value: string; expiresAt: number } | undefined {
    const entry = this.data.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.data.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    return this.alive(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.data.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(key: string): Promise<void> {
    this.data.delete(key);
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const current = Number((await this.get(key)) ?? 0);
    const next = current + 1;
    await this.set(key, String(next), ttlSeconds);
    return next;
  }
}

/** 小阈值策略便于测试 */
const policy: SmsPolicy = {
  cooldownSeconds: 60,
  codeTtlSeconds: 300,
  phoneDailyLimit: 2,
  ipDailyLimit: 3,
  maxAttempts: 3,
};

function createService(): { svc: SmsCodeService; store: MemoryKvStore } {
  const store = new MemoryKvStore();
  return { svc: new SmsCodeService(store, policy), store };
}

/** 断言抛出的 BizException 业务码 */
async function expectBizError(promise: Promise<unknown>, bizCode: number): Promise<void> {
  await expect(promise).rejects.toThrowError(expect.objectContaining({ bizCode }));
}

describe('SmsCodeService', () => {
  let ctx: ReturnType<typeof createService>;
  beforeEach(() => {
    ctx = createService();
  });

  it('issueCode：生成 6 位数字验证码', async () => {
    const code = await ctx.svc.issueCode('13800001111', '1.2.3.4');
    expect(code).toMatch(/^\d{6}$/);
    expect(await ctx.store.get('sms:code:13800001111')).toBe(code);
  });

  it('60s 冷却期内重复发送 → SMS_CODE_TOO_FREQUENT', async () => {
    await ctx.svc.issueCode('13800001111', '1.2.3.4');
    await expectBizError(ctx.svc.issueCode('13800001111', '1.2.3.4'), ErrorCode.SMS_CODE_TOO_FREQUENT);
  });

  it('手机号日限（2 次）用尽 → SMS_SEND_LIMIT_EXCEEDED', async () => {
    // 两次成功发送（手动清掉冷却键模拟跨冷却窗口）
    await ctx.svc.issueCode('13800001111', '1.2.3.4');
    await ctx.store.del('sms:cd:13800001111');
    await ctx.svc.issueCode('13800001111', '9.9.9.9');
    await ctx.store.del('sms:cd:13800001111');
    // 第三次被手机号日限拦截
    await expectBizError(ctx.svc.issueCode('13800001111', '1.2.3.4'), ErrorCode.SMS_SEND_LIMIT_EXCEEDED);
  });

  it('IP 日限（3 次）用尽 → SMS_SEND_LIMIT_EXCEEDED', async () => {
    const phones = ['13800001111', '13800002222', '13800003333', '13800004444'];
    for (const phone of phones) {
      await ctx.svc.issueCode(phone, '5.6.7.8').catch(() => undefined);
    }
    await expectBizError(ctx.svc.issueCode('13800009999', '5.6.7.8'), ErrorCode.SMS_SEND_LIMIT_EXCEEDED);
  });

  it('verifyCode：正确验证码通过且一次性销毁', async () => {
    const code = await ctx.svc.issueCode('13800001111', '1.2.3.4');
    await expect(ctx.svc.verifyCode('13800001111', code)).resolves.toBeUndefined();
    await expectBizError(ctx.svc.verifyCode('13800001111', code), ErrorCode.SMS_CODE_INVALID);
  });

  it('verifyCode：错误验证码累计尝试，超限后销毁并拒绝', async () => {
    const code = await ctx.svc.issueCode('13800001111', '1.2.3.4');
    // 连续错 3 次（= maxAttempts）
    for (let i = 0; i < policy.maxAttempts; i++) {
      await expectBizError(ctx.svc.verifyCode('13800001111', '000000'), ErrorCode.SMS_CODE_INVALID);
    }
    // 超限后即使输入正确码也失效（已被销毁）
    await expectBizError(ctx.svc.verifyCode('13800001111', code), ErrorCode.SMS_CODE_INVALID);
  });

  it('verifyCode：验证码过期 → SMS_CODE_INVALID', async () => {
    await ctx.svc.issueCode('13800001111', '1.2.3.4');
    await ctx.store.del('sms:code:13800001111');
    await expectBizError(ctx.svc.verifyCode('13800001111', '123456'), ErrorCode.SMS_CODE_INVALID);
  });
});
