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

/**
 * 统一请求封装：解析 { code, message, data } 响应体，非 0 业务码抛出 ApiError。
 */
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body = (await res.json()) as ApiResponse<T>;
  if (!isOkResponse(body)) {
    throw new ApiError(body.code, body.message);
  }
  return body.data as T;
}
