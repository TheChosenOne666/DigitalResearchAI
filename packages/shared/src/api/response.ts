import type { ErrorCodeValue } from './error-codes';

/**
 * 统一响应体：所有 REST 接口的出参包装结构。
 */
export interface ApiResponse<T = unknown> {
  /** 业务码，0 表示成功，非 0 见 ErrorCode 分段 */
  code: ErrorCodeValue;
  /** 提示信息，成功时为 'ok' */
  message: string;
  /** 业务数据，失败时为 null */
  data: T | null;
}

/** 分页数据结构 */
export interface PageData<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 类型守卫：判断响应是否为成功响应 */
export function isOkResponse<T>(res: ApiResponse<T>): res is ApiResponse<T> & { data: T } {
  return res.code === 0;
}
