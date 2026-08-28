import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { AuthService } from '../src/modules/auth/auth.service';
import { AuthController } from '../src/modules/auth/auth.controller';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { SessionService } from '../src/common/auth/session.service';
import type { SmsCodeService } from '../src/modules/auth/sms-code.service';

/** 已注册用户（含 roles，buildLoginResult 需要） */
function makeUser(id: string, phone: string) {
  return {
    id,
    phone,
    nickname: `用户${phone.slice(-4)}`,
    tenantId: `tenant_${id}`,
    status: 'ACTIVE',
    roles: [{ role: { code: 'USER' } }],
  };
}

/** PrismaService mock（覆盖 devLogin 路径用到的成员） */
function makePrisma(existingUser: unknown = null) {
  const tx = {
    tenant: { create: vi.fn().mockResolvedValue({ id: 'tenant_new' }) },
    user: {
      create: vi.fn().mockImplementation(async ({ data }: { data: { phone: string; nickname: string } }) => ({
        id: 'user_new',
        tenantId: 'tenant_new',
        phone: data.phone,
        nickname: data.nickname,
        status: 'ACTIVE',
        roles: [{ role: { code: 'USER' } }],
      })),
    },
  };
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue(existingUser),
      update: vi.fn().mockResolvedValue({ id: 'u1', lastLoginAt: new Date() }),
    },
    role: { findMany: vi.fn().mockResolvedValue([{ id: 'role1', code: 'USER' }]) },
    $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx)),
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as PrismaService;
}

function makeSession(): SessionService {
  return { createSession: vi.fn().mockResolvedValue('sid-abc') } as unknown as SessionService;
}

function makeService(prisma: PrismaService = makePrisma(), session: SessionService = makeSession()): AuthService {
  return new AuthService(prisma, session, {} as SmsCodeService);
}

describe('AuthService.devLogin', () => {
  it('未注册用户：自动创建并返回会话', async () => {
    const prisma = makePrisma(null);
    const session = makeSession();
    const res = await makeService(prisma, session).devLogin('13800001111');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(res.sessionId).toBe('sid-abc');
    expect(res.user.id).toBe('user_new');
    expect(res.user.roles).toEqual(['USER']);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });

  it('已注册用户：复用账号并返回会话（不触发创建事务）', async () => {
    const prisma = makePrisma(makeUser('user_1', '13800002222'));
    const res = await makeService(prisma).devLogin('13800002222');

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(res.sessionId).toBe('sid-abc');
    expect(res.user.id).toBe('user_1');
  });
});

describe('AuthController.devLogin 环境变量守卫', () => {
  function makeController(enabled: string | undefined) {
    const authService = {
      devLogin: vi.fn().mockResolvedValue({ sessionId: 'sid', user: { id: 'u1', nickname: 'n', phone: '13800001111', roles: ['USER'] } }),
    } as unknown as AuthService;
    const config = {
      get: vi.fn((key: string) => (key === 'DEV_LOGIN_ENABLED' ? enabled : undefined)),
    } as never;
    return new AuthController(authService, {} as SmsCodeService, config);
  }

  it('DEV_LOGIN_ENABLED=true 时放行并返回会话', async () => {
    const res = await makeController('true').devLogin({ phone: '13800001111' });
    expect(res.sessionId).toBe('sid');
  });

  it('DEV_LOGIN_ENABLED 未设置或非 true 时返回 404（隐藏接口）', () => {
    // controller 守卫在返回 Promise 前同步抛出，需用同步断言
    expect(() => makeController(undefined).devLogin({ phone: '13800001111' })).toThrow(NotFoundException);
    expect(() => makeController('false').devLogin({ phone: '13800001111' })).toThrow(NotFoundException);
  });
});
