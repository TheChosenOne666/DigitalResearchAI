import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './constants';

/** 分页参数（skip/take 供 Prisma 使用） */
export interface PageParams {
  /** 当前页（从 1 开始） */
  page: number;
  /** 每页条数 */
  pageSize: number;
  /** 跳过条数（(page - 1) * pageSize） */
  skip: number;
  /** 取用条数（= pageSize） */
  take: number;
}

/** 分页结果（统一响应结构，供所有管理端列表复用） */
export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 解析分页参数（字符串入参 → 数字，越界收敛到合法区间）。
 * @param page 页码字符串（默认 1）
 * @param pageSize 每页条数字符串（默认 DEFAULT_PAGE_SIZE，上限 MAX_PAGE_SIZE）
 */
export function parsePageParams(page?: string, pageSize?: string): PageParams {
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE));
  return { page: p, pageSize: size, skip: (p - 1) * size, take: size };
}

/** 组装分页结果 */
export function buildPageResult<T>(list: T[], total: number, params: PageParams): PageResult<T> {
  return { list, total, page: params.page, pageSize: params.pageSize };
}
