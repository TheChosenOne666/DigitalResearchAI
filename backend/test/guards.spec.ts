import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@app/shared';
import { SessionAuthGuard } from '../src/common/auth/session-auth.guard';
import { RolesGuard } from '../src/common/auth/roles.guard';
import { SessionService } from '../src/common/auth/session.service';
import { IS_PUBLIC_KEY } from '../src/common/auth/public.decorator';
import { ROLES_KEY, RoleCode } from '../src/common/auth/roles.decorator';

/** 构造模拟 ExecutionContext（handler 元数据 + 请求对象） */
function createContext(handler: { [key: symbol]: unknown }, request: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => function DummyClass() {},
  } as never extends never ? Parameters<SessionAuthGuard['canActivate']>[0] : never;
}

/** 公开路由 handler（直接挂 @Public 元数据，避免装饰器语法限制） */
const publicHandler: { [key: symbol]: unknown } = {};
Reflect.defineMetadata(IS_PUBLIC_KEY, true, publicHandler);

/** 角色限定 handler（挂 @Roles 元数据） */
const adminHandler: { [key: symbol]: unknown } = {};
Reflect.defineMetadata(ROLES_KEY, [RoleCode.DATA_ADMIN, RoleCode.PLATFORM_ADMIN], adminHandler);

/** 普通 handler（无元数据） */
const plainHandler: { [key: symbol]: unknown } = {};

const reflector = new Reflector();

describe('SessionAuthGuard', () => {
  const store = { get: async () => null, set: async () => {}, del: async () => {}, expire: async () => false, sadd: async () => {}, srem: async () => {}, smembers: async () => [] };
  const sessionService = new SessionService(store as never);
  const guard = new SessionAuthGuard(sessionService, reflector);

  it('@Public 路由：无凭证直接放行', async () => {
    const ctx = createContext(publicHandler, { headers: {} });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('普通路由：无 Authorization → 1001 未登录', async () => {
    const ctx = createContext(plainHandler, { headers: {} });
    await expect(guard.canActivate(ctx)).rejects.toThrowError(
      expect.objectContaining({ bizCode: ErrorCode.UNAUTHORIZED }),
    );
  });

  it('普通路由：无效 sessionId → 1002 会话无效', async () => {
    const ctx = createContext(plainHandler, {
      headers: { authorization: 'Bearer invalid-sid' },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrowError(
      expect.objectContaining({ bizCode: ErrorCode.INVALID_SESSION }),
    );
  });

  it('有效会话：请求挂载用户上下文', async () => {
    const resolve = vi.fn().mockResolvedValue({ userId: 'u1', tenantId: 't1', roles: ['USER'], createdAt: 1 });
    const guardWithSession = new SessionAuthGuard({ resolveSession: resolve } as never, reflector);
    const request: { headers: Record<string, string>; user?: unknown } = {
      headers: { authorization: 'Bearer valid-sid' },
    };
    const ctx = createContext(plainHandler, request);
    await expect(guardWithSession.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toEqual({ userId: 'u1', tenantId: 't1', roles: ['USER'], createdAt: 1 });
  });
});

describe('RolesGuard', () => {
  const guard = new RolesGuard(reflector);

  it('@Roles(DATA_ADMIN, PLATFORM_ADMIN)：普通 USER → 2001 无权限', () => {
    const ctx = createContext(adminHandler, { user: { roles: ['USER'] } });
    expect(() => guard.canActivate(ctx)).toThrowError(
      expect.objectContaining({ bizCode: ErrorCode.FORBIDDEN }),
    );
  });

  it('@Roles(DATA_ADMIN, PLATFORM_ADMIN)：DATA_ADMIN 放行', () => {
    const ctx = createContext(adminHandler, { user: { roles: ['USER', 'DATA_ADMIN'] } });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('未声明 @Roles 的路由：仅要求登录（认证守卫已保证），角色不校验', () => {
    const ctx = createContext(plainHandler, { user: { roles: ['USER'] } });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('@Public 路由：角色守卫同样放行', () => {
    const ctx = createContext(publicHandler, {});
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
