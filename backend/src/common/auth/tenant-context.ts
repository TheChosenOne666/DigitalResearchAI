import { AsyncLocalStorage } from 'node:async_hooks';

/** 请求级租户上下文（由 TenantContextInterceptor 从会话写入） */
export interface TenantStore {
  /** 用户 ID */
  userId: string;
  /** 租户 ID */
  tenantId: string;
  /** 角色编码列表 */
  roles: string[];
}

/** 租户上下文存储：Prisma 租户 Extension 从这里读取当前请求的租户 */
export const tenantAls = new AsyncLocalStorage<TenantStore>();

/** 获取当前请求的租户上下文（非请求线程返回 undefined） */
export function getTenantContext(): TenantStore | undefined {
  return tenantAls.getStore();
}
