import { describe, it, expect } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import {
  MockPayChannel,
  buildSignPayload,
  sign,
  safeCompare,
  NOTIFY_TTL_MS,
} from '../src/modules/member/pay/mock.channel';

/** 构造渠道实例（固定密钥，便于断言） */
function makeChannel(secret = 'test-secret'): MockPayChannel {
  const config = {
    get: <T>(_key: string, def: T): T => (_key === 'PAY_MOCK_SECRET' ? (secret as unknown as T) : def),
  } as unknown as ConfigService;
  return new MockPayChannel(config);
}

describe('buildSignPayload / sign / safeCompare', () => {
  it('待签名串按 orderNo|amountCents|transactionNo|timestamp 拼接', () => {
    expect(
      buildSignPayload({ orderNo: 'ORD1', amountCents: 49900, transactionNo: 'TXN1', timestamp: 1000 }),
    ).toBe('ORD1|49900|TXN1|1000');
  });

  it('相同输入签名稳定，不同输入签名不同', () => {
    const a = sign('abc', 'k');
    const b = sign('abc', 'k');
    const c = sign('abd', 'k');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('常量时间比较：相等为 true，长度不同不抛错', () => {
    expect(safeCompare('abc', 'abc')).toBe(true);
    expect(safeCompare('abc', 'abd')).toBe(false);
    expect(safeCompare('ab', 'abc')).toBe(false);
  });
});

describe('MockPayChannel.createPrepay', () => {
  it('返回收银台地址 + 流水号 + 签名（可用 verifyNotify 验回）', async () => {
    const ch = makeChannel();
    const prepay = await ch.createPrepay({ orderNo: 'ORD1', amountCents: 49900, subject: '专业版 · 年付' });
    expect(prepay.cashierUrl).toContain('/pay/mock?orderNo=ORD1');
    expect(prepay.transactionNo).toMatch(/^MOCK/);
    expect(prepay.subject).toBe('专业版 · 年付');

    const verified = await ch.verifyNotify({
      orderNo: 'ORD1',
      transactionNo: prepay.transactionNo as string,
      amountCents: 49900,
      timestamp: prepay.timestamp as number,
      sign: prepay.sign as string,
    });
    expect(verified).toEqual({
      orderNo: 'ORD1',
      transactionNo: prepay.transactionNo,
      amountCents: 49900,
    });
  });
});

describe('MockPayChannel.verifyNotify', () => {
  const ch = makeChannel();
  const base = { orderNo: 'ORD1', amountCents: 49900, transactionNo: 'TXN1', timestamp: Date.now() };
  const okSign = sign(buildSignPayload(base), 'test-secret');

  it('验签通过返回关键字段', async () => {
    await expect(ch.verifyNotify({ ...base, sign: okSign })).resolves.toEqual({
      orderNo: 'ORD1',
      transactionNo: 'TXN1',
      amountCents: 49900,
    });
  });

  it('篡改金额 → 验签失败（400）', async () => {
    await expect(ch.verifyNotify({ ...base, amountCents: 1, sign: okSign })).rejects.toMatchObject({
      bizCode: 3001,
    });
  });

  it('错误密钥签名 → 验签失败', async () => {
    const bad = sign(buildSignPayload(base), 'wrong-secret');
    await expect(ch.verifyNotify({ ...base, sign: bad })).rejects.toMatchObject({ bizCode: 3001 });
  });

  it('时间戳超窗（>5 分钟）→ 判定过期', async () => {
    const old = { ...base, timestamp: Date.now() - NOTIFY_TTL_MS - 1000 };
    const oldSign = sign(buildSignPayload(old), 'test-secret');
    await expect(ch.verifyNotify({ ...old, sign: oldSign })).rejects.toMatchObject({ bizCode: 3001 });
  });

  it('缺字段 / 金额非法 → 参数错误', async () => {
    await expect(
      ch.verifyNotify({ orderNo: '', transactionNo: 'T', amountCents: 1, timestamp: Date.now(), sign: 'x' }),
    ).rejects.toMatchObject({ bizCode: 3002 });
    await expect(ch.verifyNotify({ ...base, amountCents: 0, sign: okSign })).rejects.toMatchObject({
      bizCode: 3001,
    });
  });
});

describe('MockPayChannel.buildNotify（开发联调自签名）', () => {
  it('生成的报文可通过自身验签', async () => {
    const ch = makeChannel();
    const payload = ch.buildNotify({ orderNo: 'ORD1', transactionNo: 'TXN9', amountCents: 4900 });
    await expect(ch.verifyNotify(payload)).resolves.toEqual({
      orderNo: 'ORD1',
      transactionNo: 'TXN9',
      amountCents: 4900,
    });
  });
});
