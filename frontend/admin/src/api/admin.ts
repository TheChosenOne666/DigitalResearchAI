import { request } from './http';
import type { LoginResult } from '@app/shared';

/** 管理端菜单项 */
export interface AdminMenuItem {
  key: string;
  label: string;
  path: string;
  roles: string[];
}

/** 管理端菜单分组 */
export interface AdminMenuGroup {
  key: string;
  label: string;
  items: AdminMenuItem[];
}

/** 当前管理员上下文（GET /admin/me） */
export interface AdminMe {
  user: {
    id: string;
    nickname: string;
    phone: string;
    tenantId: string;
    tenantName: string;
  };
  roles: string[];
  menus: AdminMenuGroup[];
}

/** 运营看板 KPI */
export interface AdminKpis {
  totalUsers: number;
  newUsers: number;
  totalSearches: number;
  todaySearches: number;
  incomeCents: number;
}

/** 运营看板趋势（近 7 日） */
export interface AdminTrends {
  days: string[];
  newUsers: number[];
  activeUsers: number[];
  searches: number[];
}

/** 运营看板待办 */
export interface AdminTodos {
  importPending: number;
  kbReviewPending: number;
  expiringMembers: number;
}

/** 近 7 日运营概览 */
export interface AdminSummary {
  activeUsers: number;
  avgSearches: number;
  reportCount: number;
  newChunks: number;
}

/** 运营看板聚合结果（GET /admin/dashboard/overview） */
export interface AdminOverview {
  range: 'today' | '7d' | '30d';
  degraded: boolean;
  kpis: AdminKpis;
  trends: AdminTrends;
  todos: AdminTodos;
  overview: AdminSummary;
}

/** 账密登录（POST /auth/login） */
export function login(phone: string, password: string): Promise<LoginResult> {
  return request<LoginResult>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ phone, password }),
  });
}

/** 当前管理员上下文（含按角色过滤后的菜单） */
export function fetchMe(): Promise<AdminMe> {
  return request<AdminMe>('/api/v1/admin/me');
}

/** 运营看板聚合数据 */
export function fetchOverview(range: string): Promise<AdminOverview> {
  return request<AdminOverview>(`/api/v1/admin/dashboard/overview?range=${range}`);
}

/* ===== M6.2 组织用户 ===== */

/** 统一分页结果 */
export interface AdminPage<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 用户行（A-02） */
export interface AdminUserRow {
  id: string;
  username: string | null;
  realName: string | null;
  nickname: string;
  phone: string;
  organization: string | null;
  status: 'ACTIVE' | 'DISABLED';
  roles: string[];
  createdAt: string;
}

/** 用户列表筛选参数 */
export interface AdminUserQuery {
  keyword?: string;
  role?: string;
  status?: string;
  page: number;
  pageSize: number;
}

/** 新增/编辑用户入参 */
export interface AdminUserInput {
  username: string;
  realName: string;
  phone: string;
  organization?: string;
  role?: string;
  password?: string;
}

/** 用户列表（A-02） */
export function fetchUsers(query: AdminUserQuery): Promise<AdminPage<AdminUserRow>> {
  const qs = new URLSearchParams();
  if (query.keyword) qs.set('keyword', query.keyword);
  if (query.role) qs.set('role', query.role);
  if (query.status) qs.set('status', query.status);
  qs.set('page', String(query.page));
  qs.set('pageSize', String(query.pageSize));
  return request<AdminPage<AdminUserRow>>(`/api/v1/admin/users?${qs.toString()}`);
}

/** 新增用户（A-02） */
export function createUser(body: AdminUserInput): Promise<AdminUserRow> {
  return request<AdminUserRow>('/api/v1/admin/users', { method: 'POST', body: JSON.stringify(body) });
}

/** 编辑用户（A-02） */
export function updateUser(id: string, body: AdminUserInput): Promise<AdminUserRow> {
  return request<AdminUserRow>(`/api/v1/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

/** 禁用/启用用户（A-02） */
export function setUserStatus(id: string, status: 'ACTIVE' | 'DISABLED'): Promise<{ id: string; status: string }> {
  return request<{ id: string; status: string }>(`/api/v1/admin/users/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

/** 重置密码（A-02） */
export function resetUserPassword(id: string, newPassword: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/v1/admin/users/${id}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ newPassword }),
  });
}

/** 角色绑定（A-02） */
export function setUserRoles(id: string, roles: string[]): Promise<{ id: string; roles: string[] }> {
  return request<{ id: string; roles: string[] }>(`/api/v1/admin/users/${id}/roles`, {
    method: 'PATCH',
    body: JSON.stringify({ roles }),
  });
}

/** 会员套餐行（A-03） */
export interface AdminPlanRow {
  id: string;
  code: string;
  level: string;
  levelName: string;
  cycle: string;
  cycleName: string;
  name: string;
  tag: string | null;
  badge: string | null;
  priceCents: number;
  originPriceCents: number | null;
  features: string[];
  sort: number;
  enabled: boolean;
}

/** 缴费订单行（A-03） */
export interface AdminOrderRow {
  id: string;
  orderNo: string;
  userId: string;
  user: { id: string; username: string | null; realName: string | null; phone: string; nickname: string } | null;
  level: string;
  levelName: string;
  cycleName: string;
  planName: string;
  amountCents: number;
  channel: string;
  status: string;
  paidAt: string | null;
  createdAt: string;
}

/** 续费提醒行（A-03） */
export interface AdminRenewalRow {
  userId: string;
  user: { id: string; username: string | null; realName: string | null; phone: string; nickname: string } | null;
  level: string;
  levelName: string;
  cycleName: string | null;
  expireAt: string;
  daysLeft: number;
  reminded: boolean;
  remindedAt: string | null;
}

/** 会员套餐列表（A-03） */
export function fetchPlans(): Promise<AdminPlanRow[]> {
  return request<AdminPlanRow[]>('/api/v1/admin/members/plans');
}

/** 新增会员套餐（A-03） */
export function createPlan(body: Record<string, unknown>): Promise<AdminPlanRow> {
  return request<AdminPlanRow>('/api/v1/admin/members/plans', { method: 'POST', body: JSON.stringify(body) });
}

/** 编辑会员套餐（A-03） */
export function updatePlan(id: string, body: Record<string, unknown>): Promise<AdminPlanRow> {
  return request<AdminPlanRow>(`/api/v1/admin/members/plans/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

/** 会员套餐上下架（A-03） */
export function setPlanEnabled(id: string, enabled: boolean): Promise<{ id: string; enabled: boolean }> {
  return request<{ id: string; enabled: boolean }>(`/api/v1/admin/members/plans/${id}/enabled`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}

/** 缴费订单列表（A-03） */
export function fetchOrders(query: { status?: string; keyword?: string; page: number; pageSize: number }): Promise<AdminPage<AdminOrderRow>> {
  const qs = new URLSearchParams();
  if (query.status) qs.set('status', query.status);
  if (query.keyword) qs.set('keyword', query.keyword);
  qs.set('page', String(query.page));
  qs.set('pageSize', String(query.pageSize));
  return request<AdminPage<AdminOrderRow>>(`/api/v1/admin/members/orders?${qs.toString()}`);
}

/** 续费提醒列表（A-03） */
export function fetchRenewals(): Promise<AdminRenewalRow[]> {
  return request<AdminRenewalRow[]>('/api/v1/admin/members/renewals');
}

/** 发送单条续费提醒（A-03） */
export function sendRenewal(userId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/v1/admin/members/renewals/${userId}/send`, { method: 'POST' });
}

/** 批量续费提醒（A-03） */
export function batchRenewal(userIds: string[]): Promise<{ sent: number }> {
  return request<{ sent: number }>('/api/v1/admin/members/renewals/batch', {
    method: 'POST',
    body: JSON.stringify({ userIds }),
  });
}

/** 角色信息（A-04） */
export interface AdminRoleInfo {
  code: string;
  name: string;
  description: string;
}

/** 权限矩阵行（A-04） */
export interface AdminPermissionRow {
  module: string;
  PLATFORM_ADMIN: boolean;
  DATA_ADMIN: boolean;
  USER: boolean;
}

/** 角色列表 + 权限矩阵（A-04） */
export function fetchRoles(): Promise<{ roles: AdminRoleInfo[]; matrix: AdminPermissionRow[] }> {
  return request<{ roles: AdminRoleInfo[]; matrix: AdminPermissionRow[] }>('/api/v1/admin/roles');
}

/* ===== M6.3 数据资源 / 数据治理 / 运营管理 ===== */

/** 指标行（A-05） */
export interface AdminIndicatorRow {
  id: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  definition: string | null;
  enabled: boolean;
  mappingCount: number;
  createdAt: string;
}

/** 指标来源映射行（A-05） */
export interface AdminMappingRow {
  id: string;
  indicatorId: string;
  sourceName: string;
  sourceField: string;
  transform: string | null;
  enabled: boolean;
}

/** 指标列表（A-05） */
export function fetchIndicators(query: { keyword?: string; category?: string; enabled?: string; page: number; pageSize: number }): Promise<AdminPage<AdminIndicatorRow>> {
  const qs = new URLSearchParams();
  if (query.keyword) qs.set('keyword', query.keyword);
  if (query.category) qs.set('category', query.category);
  if (query.enabled) qs.set('enabled', query.enabled);
  qs.set('page', String(query.page));
  qs.set('pageSize', String(query.pageSize));
  return request<AdminPage<AdminIndicatorRow>>(`/api/v1/admin/indicators?${qs.toString()}`);
}

/** 新增指标（A-05） */
export function createIndicator(body: Record<string, unknown>): Promise<AdminIndicatorRow> {
  return request<AdminIndicatorRow>('/api/v1/admin/indicators', { method: 'POST', body: JSON.stringify(body) });
}

/** 编辑指标（A-05） */
export function updateIndicator(id: string, body: Record<string, unknown>): Promise<AdminIndicatorRow> {
  return request<AdminIndicatorRow>(`/api/v1/admin/indicators/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

/** 删除指标（A-05，被映射占用时禁删） */
export function removeIndicator(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/v1/admin/indicators/${id}`, { method: 'DELETE' });
}

/** 指标来源映射列表（A-05） */
export function fetchMappings(indicatorId: string): Promise<AdminMappingRow[]> {
  return request<AdminMappingRow[]>(`/api/v1/admin/indicators/${indicatorId}/mappings`);
}

/** 新增来源映射（A-05） */
export function createMapping(indicatorId: string, body: Record<string, unknown>): Promise<AdminMappingRow> {
  return request<AdminMappingRow>(`/api/v1/admin/indicators/${indicatorId}/mappings`, { method: 'POST', body: JSON.stringify(body) });
}

/** 编辑来源映射（A-05） */
export function updateMapping(indicatorId: string, mid: string, body: Record<string, unknown>): Promise<AdminMappingRow> {
  return request<AdminMappingRow>(`/api/v1/admin/indicators/${indicatorId}/mappings/${mid}`, { method: 'PUT', body: JSON.stringify(body) });
}

/** 删除来源映射（A-05） */
export function removeMapping(indicatorId: string, mid: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/v1/admin/indicators/${indicatorId}/mappings/${mid}`, { method: 'DELETE' });
}

/** 字典类型 */
export type DictType = 'COUNTRY' | 'ORG' | 'INDUSTRY' | 'UNIT' | 'TIME';

/** 字典项行（A-06） */
export interface AdminDictRow {
  id: string;
  type: DictType;
  code: string;
  name: string;
  nameEn: string | null;
  parentCode: string | null;
  remark: string | null;
  sort: number;
  enabled: boolean;
  createdAt: string;
}

/** 字典列表（A-06，type 必填） */
export function fetchDicts(query: { type: string; keyword?: string; enabled?: string; page: number; pageSize: number }): Promise<AdminPage<AdminDictRow>> {
  const qs = new URLSearchParams();
  qs.set('type', query.type);
  if (query.keyword) qs.set('keyword', query.keyword);
  if (query.enabled) qs.set('enabled', query.enabled);
  qs.set('page', String(query.page));
  qs.set('pageSize', String(query.pageSize));
  return request<AdminPage<AdminDictRow>>(`/api/v1/admin/dicts?${qs.toString()}`);
}

/** 新增字典项（A-06） */
export function createDict(body: Record<string, unknown>): Promise<AdminDictRow> {
  return request<AdminDictRow>('/api/v1/admin/dicts', { method: 'POST', body: JSON.stringify(body) });
}

/** 编辑字典项（A-06） */
export function updateDict(id: string, body: Record<string, unknown>): Promise<AdminDictRow> {
  return request<AdminDictRow>(`/api/v1/admin/dicts/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

/** 字典项停用/启用（A-06） */
export function setDictEnabled(id: string, enabled: boolean): Promise<{ id: string; enabled: boolean }> {
  return request<{ id: string; enabled: boolean }>(`/api/v1/admin/dicts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}

/** 数据集行（A-07） */
export interface AdminDatasetRow {
  id: string;
  tenantId: string | null;
  name: string;
  source: 'IMPORT' | 'UPLOAD' | 'COLLECT';
  category: string | null;
  fieldCount: number;
  status: 'ONLINE' | 'OFFLINE';
  meta: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

/** 数据集列表（A-07） */
export function fetchDatasets(query: { keyword?: string; source?: string; status?: string; page: number; pageSize: number }): Promise<AdminPage<AdminDatasetRow>> {
  const qs = new URLSearchParams();
  if (query.keyword) qs.set('keyword', query.keyword);
  if (query.source) qs.set('source', query.source);
  if (query.status) qs.set('status', query.status);
  qs.set('page', String(query.page));
  qs.set('pageSize', String(query.pageSize));
  return request<AdminPage<AdminDatasetRow>>(`/api/v1/admin/datasets?${qs.toString()}`);
}

/** 编辑数据集元数据（A-07） */
export function updateDataset(id: string, body: Record<string, unknown>): Promise<AdminDatasetRow> {
  return request<AdminDatasetRow>(`/api/v1/admin/datasets/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

/** 数据集上下架（A-07） */
export function setDatasetStatus(id: string, status: 'ONLINE' | 'OFFLINE'): Promise<{ id: string; status: string }> {
  return request<{ id: string; status: string }>(`/api/v1/admin/datasets/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

/** 导入审核任务行（A-08） */
export interface AdminImportRow {
  id: string;
  name: string;
  type: 'EXCEL' | 'CSV' | 'DATABASE' | 'API';
  sizeBytes: number | null;
  submitterId: string;
  submitter: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  overdue: boolean;
}

/** 导入审核队列（A-08） */
export function fetchImports(query: { status?: string; type?: string; page: number; pageSize: number }): Promise<AdminPage<AdminImportRow>> {
  const qs = new URLSearchParams();
  if (query.status) qs.set('status', query.status);
  if (query.type) qs.set('type', query.type);
  qs.set('page', String(query.page));
  qs.set('pageSize', String(query.pageSize));
  return request<AdminPage<AdminImportRow>>(`/api/v1/admin/imports?${qs.toString()}`);
}

/** 导入审核通过（A-08） */
export function approveImport(id: string): Promise<{ id: string; status: string }> {
  return request<{ id: string; status: string }>(`/api/v1/admin/imports/${id}/approve`, { method: 'POST' });
}

/** 导入审核退回（A-08，原因必填） */
export function rejectImport(id: string, reason: string): Promise<{ id: string; status: string }> {
  return request<{ id: string; status: string }>(`/api/v1/admin/imports/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

/** 导入数据预览（A-08，前 5 行） */
export function fetchImportPreview(id: string): Promise<{ id: string; name: string; type: string; preview: { headers?: string[]; rows?: unknown[][] } | null }> {
  return request<{ id: string; name: string; type: string; preview: { headers?: string[]; rows?: unknown[][] } | null }>(`/api/v1/admin/imports/${id}/preview`);
}

/** 公告行（A-09） */
export interface AdminNoticeRow {
  id: string;
  title: string;
  content: string;
  scope: 'ALL' | 'ROLE' | 'ORG';
  scopeValue: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'WITHDRAWN';
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 公告列表（A-09） */
export function fetchNotices(query: { status?: string; page: number; pageSize: number }): Promise<AdminPage<AdminNoticeRow>> {
  const qs = new URLSearchParams();
  if (query.status) qs.set('status', query.status);
  qs.set('page', String(query.page));
  qs.set('pageSize', String(query.pageSize));
  return request<AdminPage<AdminNoticeRow>>(`/api/v1/admin/notices?${qs.toString()}`);
}

/** 新建公告（A-09） */
export function createNotice(body: Record<string, unknown>): Promise<AdminNoticeRow> {
  return request<AdminNoticeRow>('/api/v1/admin/notices', { method: 'POST', body: JSON.stringify(body) });
}

/** 编辑公告（A-09） */
export function updateNotice(id: string, body: Record<string, unknown>): Promise<AdminNoticeRow> {
  return request<AdminNoticeRow>(`/api/v1/admin/notices/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

/** 发布公告（A-09） */
export function publishNotice(id: string): Promise<{ id: string; status: string }> {
  return request<{ id: string; status: string }>(`/api/v1/admin/notices/${id}/publish`, { method: 'POST' });
}

/** 撤回公告（A-09） */
export function withdrawNotice(id: string): Promise<{ id: string; status: string }> {
  return request<{ id: string; status: string }>(`/api/v1/admin/notices/${id}/withdraw`, { method: 'POST' });
}

/** 搜索词统计行（A-10） */
export interface AdminSearchTermRow {
  id: string;
  term: string;
  totalCount: number;
  emptyCount: number;
  lastSearchedAt: string | null;
  isQuick: boolean;
  isSuggest: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 敏感词行（A-10） */
export interface AdminSensitiveRow {
  id: string;
  word: string;
  type: 'POLITICS' | 'ILLEGAL' | 'OTHER';
  hitCount: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 搜索词统计（A-10，kind=hot|empty） */
export function fetchSearchTerms(kind: 'hot' | 'empty', page: number, pageSize: number): Promise<AdminPage<AdminSearchTermRow>> {
  return request<AdminPage<AdminSearchTermRow>>(`/api/v1/admin/search-ops/terms?kind=${kind}&page=${page}&pageSize=${pageSize}`);
}

/** 搜索词运营动作（A-10：设为快捷检索 / 加入搜索建议） */
export function setTermFlags(id: string, flags: { isQuick?: boolean; isSuggest?: boolean }): Promise<AdminSearchTermRow> {
  return request<AdminSearchTermRow>(`/api/v1/admin/search-ops/terms/${id}/flags`, {
    method: 'PATCH',
    body: JSON.stringify(flags),
  });
}

/** 敏感词列表（A-10） */
export function fetchSensitive(query: { keyword?: string; enabled?: string; page: number; pageSize: number }): Promise<AdminPage<AdminSensitiveRow>> {
  const qs = new URLSearchParams();
  if (query.keyword) qs.set('keyword', query.keyword);
  if (query.enabled) qs.set('enabled', query.enabled);
  qs.set('page', String(query.page));
  qs.set('pageSize', String(query.pageSize));
  return request<AdminPage<AdminSensitiveRow>>(`/api/v1/admin/search-ops/sensitive?${qs.toString()}`);
}

/** 新增敏感词（A-10） */
export function createSensitive(body: Record<string, unknown>): Promise<AdminSensitiveRow> {
  return request<AdminSensitiveRow>('/api/v1/admin/search-ops/sensitive', { method: 'POST', body: JSON.stringify(body) });
}

/** 编辑敏感词（A-10） */
export function updateSensitive(id: string, body: Record<string, unknown>): Promise<AdminSensitiveRow> {
  return request<AdminSensitiveRow>(`/api/v1/admin/search-ops/sensitive/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

/** 敏感词启用/停用（A-10） */
export function setSensitiveEnabled(id: string, enabled: boolean): Promise<{ id: string; enabled: boolean }> {
  return request<{ id: string; enabled: boolean }>(`/api/v1/admin/search-ops/sensitive/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}
