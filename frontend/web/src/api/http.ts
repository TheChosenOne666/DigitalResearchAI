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

/** 本地持久化的 sessionId（与 session store 共享 key） */
const SESSION_KEY = 'web.sessionId';

/**
 * 统一请求封装：解析 { code, message, data } 响应体，非 0 业务码抛出 ApiError；
 * 存在本地会话时自动携带 Authorization: Bearer <sessionId>；
 * FormData 请求体不设置 Content-Type（交由浏览器生成 multipart 边界）。
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
