import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

/** 请求上下文：贯穿 HTTP 请求与 BullMQ worker 的最小上下文 */
export interface RequestContext {
  requestId: string;
}

/** AsyncLocalStorage 实例（模块级单例，零依赖注入成本） */
export const requestAls = new AsyncLocalStorage<RequestContext>();

/** 读取当前 requestId；非 HTTP/worker 上下文返回 undefined */
export function getRequestId(): string | undefined {
  return requestAls.getStore()?.requestId;
}

/** 在指定 requestId 上下文中执行函数（BullMQ worker / 定时任务用） */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return requestAls.run({ requestId }, fn);
}

/** 生成新 requestId：req-<时间戳36进制>-<4字节随机> */
export function newRequestId(): string {
  return `req-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}
