import { request } from '@/api/http';

const BASE = '/api/v1/member';
const BILLING = '/api/v1/billing';

// ===== 类型定义（与后端 member/billing 模块响应对齐）=====

/** 支付渠道 */
export type PayChannel = 'MOCK' | 'WECHAT' | 'ALIPAY';

/** 会员等级 */
export type MemberLevel = 'FREE' | 'PRO' | 'ENTERPRISE';

/** 购买周期 */
export type PlanCycle = 'SINGLE' | 'MONTHLY' | 'YEAR';

/** 订单状态 */
export type OrderStatus = 'PENDING' | 'PAID' | 'CANCELLED' | 'CLOSED' | 'FAILED';

/** 套餐项（会员中心卡片） */
export interface MemberPlanItem {
  id: string;
  code: string;
  cycle: PlanCycle;
  cycleName: string;
  name: string;
  badge: string | null;
  priceCents: number;
  amount: number;
  originPriceCents: number | null;
  originAmount: number | null;
  /** 年付折算月单价（元），非年付为 null */
  monthAmount: number | null;
  features: string[];
}

/** 套餐分组（按等级） */
export interface MemberPlanLevel {
  level: MemberLevel;
  levelName: string;
  tag: string | null;
  plans: MemberPlanItem[];
}

/** 会员状态 */
export interface MemberStatus {
  isMember: boolean;
  level: MemberLevel;
  levelName: string;
  cycle: PlanCycle | null;
  cycleName: string | null;
  /** 到期时间（ISO），非会员为 null */
  expireAt: string | null;
  daysLeft: number;
  autoRenew: boolean;
  totalPeriods: number;
  /** 免费体验剩余次数；null 表示不限（会员/管理员） */
  trialLeft: number | null;
}

/** 会员订单 */
export interface MemberOrder {
  id: string;
  orderNo: string;
  planName: string;
  level: MemberLevel;
  levelName: string;
  cycle: PlanCycle;
  cycleName: string;
  amountCents: number;
  amount: number;
  channel: PayChannel;
  channelName: string;
  status: OrderStatus;
  statusName: string;
  periodStart: string | null;
  periodEnd: string | null;
  payInfo: { cashierUrl?: string; transactionNo?: string } | null;
  paidAt: string | null;
  expireAt: string | null;
  isRenewal: boolean;
  createdAt: string;
}

/** 支付流水（账单页） */
export interface PaymentItem {
  id: string;
  transactionNo: string;
  channel: PayChannel;
  orderId: string;
  orderNo: string;
  amountCents: number;
  amount: number;
  status: string;
  paidAt: string;
}

/** 支付回调结果 */
export interface PayResult {
  ok: boolean;
  duplicate?: boolean;
  reason?: 'AMOUNT_MISMATCH' | 'ORDER_NOT_PENDING';
  periodStart?: string;
  periodEnd?: string;
}

/** 分页结果 */
export interface Paged<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ===== 套餐与会员 =====

/** 套餐列表（按等级分组） */
export function fetchPlans(): Promise<{ levels: MemberPlanLevel[]; trialLimit: number }> {
  return request(`${BASE}/plans`);
}

/** 当前会员状态 */
export function fetchMemberStatus(): Promise<MemberStatus> {
  return request(`${BASE}/subscription`);
}

/** 连续包月自动续费开关 */
export function setAutoRenew(enabled: boolean): Promise<{ autoRenew: boolean }> {
  return request(`${BASE}/subscription/auto-renew`, {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
}

// ===== 订单与支付 =====

/** 下单 */
export function createOrder(planId: string, channel?: PayChannel): Promise<MemberOrder> {
  return request(`${BASE}/orders`, {
    method: 'POST',
    body: JSON.stringify({ planId, channel }),
  });
}

/** 发起支付（返回渠道预支付参数） */
export function payOrder(
  orderNo: string,
  channel?: PayChannel,
): Promise<{ order: MemberOrder; payInfo: Record<string, unknown> }> {
  return request(`${BASE}/orders/${orderNo}/pay`, {
    method: 'POST',
    body: JSON.stringify({ channel }),
  });
}

/** 取消订单（仅待支付） */
export function cancelOrder(orderNo: string): Promise<MemberOrder> {
  return request(`${BASE}/orders/${orderNo}/cancel`, { method: 'POST' });
}

/** 开发联调：模拟支付成功（服务端自签名后走真实回调链路） */
export function mockPayOrder(orderNo: string): Promise<PayResult> {
  return request(`${BASE}/orders/${orderNo}/mock-pay`, { method: 'POST' });
}

/** 订单详情（支付后轮询查单） */
export function fetchOrderDetail(orderNo: string): Promise<MemberOrder> {
  return request(`${BASE}/orders/${orderNo}`);
}

/** 我的订单列表 */
export function fetchOrders(params?: {
  status?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}): Promise<Paged<MemberOrder>> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.keyword) qs.set('keyword', params.keyword);
  qs.set('page', String(params?.page ?? 1));
  qs.set('pageSize', String(params?.pageSize ?? 20));
  return request(`${BASE}/orders?${qs.toString()}`);
}

/** 待支付订单（支付中心顶部卡片） */
export function fetchPendingOrder(): Promise<MemberOrder | null> {
  return request(`${BASE}/orders/pending`);
}

// ===== 账单 =====

/** 账单-订单列表 */
export function fetchBillingOrders(params?: {
  range?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<Paged<MemberOrder>> {
  const qs = new URLSearchParams();
  if (params?.range) qs.set('range', params.range);
  if (params?.status) qs.set('status', params.status);
  qs.set('page', String(params?.page ?? 1));
  qs.set('pageSize', String(params?.pageSize ?? 20));
  return request(`${BILLING}/orders?${qs.toString()}`);
}

/** 账单-支付流水 */
export function fetchBillingPayments(params?: {
  page?: number;
  pageSize?: number;
}): Promise<Paged<PaymentItem>> {
  const qs = new URLSearchParams();
  qs.set('page', String(params?.page ?? 1));
  qs.set('pageSize', String(params?.pageSize ?? 20));
  return request(`${BILLING}/payments?${qs.toString()}`);
}

/** 金额格式化（分 → ¥xx.xx） */
export function money(cents: number): string {
  return `¥ ${(cents / 100).toFixed(2)}`;
}

/** 日期格式化（ISO → yyyy-MM-dd） */
export function dateOnly(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/** 时间格式化（ISO → yyyy-MM-dd HH:mm） */
export function dateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
