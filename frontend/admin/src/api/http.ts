import { isOkResponse } from '@app/shared';
import type { ApiResponse } from '@app/shared';

/** 业务错误：携带统一响应体中的业务码 */
export class ApiError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 本地持久化的 sessionId（管理端独立命名空间，与用户端 web.sessionId 隔离） */
const SESSION_KEY = 'admin.sessionId';

/**
 * 统一请求封装：解析 { code, message, data } 响应体，非 0 业务码抛出 ApiError；
 * 存在本地会话时自动携带 Authorization: Bearer <sessionId>。
 */
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const sessionId = localStorage.getItem(SESSION_KEY);
  const headers: Record<string, string> = {};
  if (!(init?.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (sessionId) {
    headers.Authorization = `Bearer ${sessionId}`;
  }
  const res = await fetch(url, { headers, ...init });
  const body = (await res.json()) as ApiResponse<T>;
  if (!isOkResponse(body)) {
    throw new ApiError(body.code, body.message);
  }
  return body.data as T;
}
