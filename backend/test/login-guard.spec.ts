import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService, type LoginGuardPolicy } from '../src/modules/auth/auth.service';
import { ErrorCode } from '@app/shared';
import type { SmsKvStore } from '../src/modules/auth/sms-code.service';

vi.mock('bcryptjs', () => ({ compare: vi.fn() }));
import { compare } from 'bcryptjs';

/** 内存 KV（与 Redis 同语义：incr 首次建键，测试不连 Redis） */
function memKv(): SmsKvStore {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => { m.set(k, v); },
    del: async (k) => { m.delete(k); },
    incr: async (k) => { const n = Number(m.get(k) ?? 0) + 1; m.set(k, String(n)); return n; },
  };
}

const user = {
  id: 'u1',
  phone: '13800000000',
  nickname: 'x',
  tenantId: 't1',
  status: 'ACTIVE',
  passwordHash: 'hashed',
  roles: [{ role: { code: 'USER' } }],
};

function makeSvc(kv: SmsKvStore, policy: LoginGuardPolicy, existing: unknown = user) {
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(existing),
      update: vi.fn().mockResolvedValue({ id: 'u1' }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  } as never;
  const session = { createSession: vi.fn().mockResolvedValue('sid') } as never;
  const sms = {} as never;
  return { svc: new AuthService(prisma, session, sms, kv, policy), prisma };
}

// 小阈值便于测试：连续 2 次失败即锁
const policy: LoginGuardPolicy = { maxFailures: 2, lockSeconds: 60 };

describe('M7.3 登录账号维度防刷', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('连续失败达阈值后锁定：即使密码正确也拒绝', async () => {
    const { svc } = makeSvc(memKv(), policy);
    (compare as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    await expect(svc.passwordLogin('13800000000', 'bad')).rejects.toMatchObject({ bizCode: ErrorCode.LOGIN_FAILED });
    await expect(svc.passwordLogin('13800000000', 'bad')).rejects.toMatchObject({ bizCode: ErrorCode.LOGIN_FAILED });
    // 已累计 2 次失败，第三次即使密码对也被锁
    (compare as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    await expect(svc.passwordLogin('13800000000', 'right')).rejects.toMatchObject({ bizCode: ErrorCode.LOGIN_LOCKED });
  });

  it('登录成功后清零失败计数', async () => {
    const { svc } = makeSvc(memKv(), policy);
    (compare as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    await expect(svc.passwordLogin('13800000000', 'bad')).rejects.toMatchObject({ bizCode: ErrorCode.LOGIN_FAILED });

    (compare as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const res = await svc.passwordLogin('13800000000', 'right');
    expect(res.sessionId).toBe('sid');

    // 清零后再失败一次：仍是 LOGIN_FAILED 而非 LOCKED
    (compare as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    await expect(svc.passwordLogin('13800000000', 'bad')).rejects.toMatchObject({ bizCode: ErrorCode.LOGIN_FAILED });
  });

  it('用户不存在也累计失败（防手机号枚举）', async () => {
    const { svc } = makeSvc(memKv(), policy, null);
    await expect(svc.passwordLogin('13800000000', 'x')).rejects.toMatchObject({ bizCode: ErrorCode.LOGIN_FAILED });
    await expect(svc.passwordLogin('13800000000', 'x')).rejects.toMatchObject({ bizCode: ErrorCode.LOGIN_FAILED });
    await expect(svc.passwordLogin('13800000000', 'x')).rejects.toMatchObject({ bizCode: ErrorCode.LOGIN_LOCKED });
  });
});
