<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import TopNav from '@/components/TopNav.vue';
import PayMethodPicker from '@/components/PayMethodPicker.vue';
import {
  fetchMemberStatus,
  fetchPendingOrder,
  fetchOrders,
  payOrder,
  mockPayOrder,
  cancelOrder,
  money,
  dateOnly,
  dateTime,
  type MemberOrder,
  type MemberStatus,
  type PayChannel,
} from '@/api/member';

const router = useRouter();

const loading = ref(true);
const status = ref<MemberStatus | null>(null);
const pending = ref<MemberOrder | null>(null);
const orders = ref<MemberOrder[]>([]);
const payMethod = ref<PayChannel>('MOCK');
const paying = ref(false);

/** 加载会员状态 + 待支付订单 + 历史订单 */
async function load(): Promise<void> {
  loading.value = true;
  try {
    const [st, po, list] = await Promise.all([
      fetchMemberStatus(),
      fetchPendingOrder(),
      fetchOrders({ page: 1, pageSize: 20 }),
    ]);
    status.value = st;
    pending.value = po;
    orders.value = list.list;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '支付信息加载失败');
  } finally {
    loading.value = false;
  }
}

/** 立即支付：发起支付 → 模拟渠道回调 → 刷新 */
async function payNow(): Promise<void> {
  const order = pending.value;
  if (!order || paying.value) return;
  paying.value = true;
  try {
    await payOrder(order.orderNo, 'MOCK');
    await mockPayOrder(order.orderNo);
    ElMessage.success(`支付成功，${order.planName} 已生效`);
    await load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '支付失败，请稍后重试');
  } finally {
    paying.value = false;
  }
}

/** 取消待支付订单 */
async function cancelPending(): Promise<void> {
  const order = pending.value;
  if (!order) return;
  try {
    await cancelOrder(order.orderNo);
    ElMessage.success('订单已取消');
    await load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '取消失败');
  }
}

/** 状态标签配色 */
function statusClass(s: string): string {
  if (s === 'PAID') return 'success';
  if (s === 'PENDING') return 'warning';
  if (s === 'FAILED') return 'danger';
  return 'muted';
}

onMounted(load);
</script>

<template>
  <div class="pay-shell">
    <TopNav />
    <div v-loading="loading" class="pay-page">
      <div class="page-head">
        <div>
          <h1>结算支付</h1>
          <p>会员升级与费用结算</p>
        </div>
      </div>

      <!-- 会员状态条（与会员中心联动） -->
      <div v-if="status" class="vip-pay-status" :class="{ 'is-expired': !status.isMember }">
        <span class="vip-pay-ic">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M3 8l4 3 5-6 5 6 4-3v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" fill="currentColor" />
          </svg>
        </span>
        <div class="vip-pay-main">
          <template v-if="status.isMember">
            <b>已开通 {{ status.levelName }} · {{ status.cycleName }}</b>
            <span>有效期至 {{ dateOnly(status.expireAt) }}（剩余 {{ status.daysLeft }} 天）· AI 智搜不限次数</span>
          </template>
          <template v-else>
            <b>{{ status.trialLeft === 0 ? '当前为非会员（免费体验已用完）' : `当前为非会员 · 免费体验剩余 ${status.trialLeft ?? 0} 次` }}</b>
            <span>开通会员解锁 AI 智搜无限次与全部数据分析能力</span>
          </template>
        </div>
        <div class="vip-pay-actions">
          <button class="btn sm primary" @click="router.push('/vip')">开通会员</button>
        </div>
      </div>

      <!-- 待支付订单 -->
      <div class="pay-order">
        <template v-if="pending">
          <div>
            <div class="po-label">待支付订单 · {{ pending.planName }}</div>
            <div class="po-amount">{{ money(pending.amountCents) }}</div>
            <div class="po-meta">
              订单号 {{ pending.orderNo }}
              <template v-if="pending.periodEnd"> · 有效期至 {{ dateOnly(pending.periodEnd) }}</template>
            </div>
          </div>
          <div class="po-actions">
            <button class="btn" :disabled="paying" @click="cancelPending">取消订单</button>
            <button class="btn primary" :disabled="paying" @click="payNow">
              {{ paying ? '支付中…' : '立即支付' }}
            </button>
          </div>
        </template>
        <template v-else>
          <div>
            <div class="po-label">当前没有待支付订单</div>
            <div class="po-amount done">全部订单已结清</div>
          </div>
          <button class="btn" @click="router.push('/vip')">查看会员方案</button>
        </template>
      </div>

      <!-- 支付方式 -->
      <section class="panel">
        <div class="panel-head"><h2>选择支付方式</h2></div>
        <div class="panel-body">
          <PayMethodPicker v-model="payMethod" />
        </div>
      </section>

      <!-- 历史订单 -->
      <section class="panel">
        <div class="panel-head">
          <h2>历史订单</h2>
          <span class="sub">订单状态实时更新</span>
        </div>
        <div class="panel-body">
          <table class="data-table">
            <thead>
              <tr>
                <th>订单号</th>
                <th>订单内容</th>
                <th>金额</th>
                <th>支付渠道</th>
                <th>状态</th>
                <th>下单时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!orders.length">
                <td colspan="6" class="empty">暂无订单记录</td>
              </tr>
              <tr v-for="o in orders" :key="o.orderNo">
                <td class="mono">{{ o.orderNo }}</td>
                <td>{{ o.planName }}</td>
                <td class="num">{{ money(o.amountCents) }}</td>
                <td>{{ o.channelName }}</td>
                <td><span class="status" :class="statusClass(o.status)">{{ o.statusName }}</span></td>
                <td class="muted">{{ dateTime(o.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.pay-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f8fafc;
}

.pay-page {
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
  padding: 20px 24px 48px;
}

.page-head h1 {
  margin: 0;
  font-size: 22px;
  color: #0f172a;
}

.page-head p {
  margin: 6px 0 18px;
  font-size: 13px;
  color: #64748b;
}

/* 会员状态条 */
.vip-pay-status {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid #fde68a;
  background: linear-gradient(135deg, #fffbeb, #fef3c7);
  margin-bottom: 16px;
}

.vip-pay-status.is-expired {
  border-color: #e2e8f0;
  background: #f8fafc;
}

.vip-pay-ic {
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: #fde68a;
  color: #b45309;
}

.vip-pay-ic svg {
  width: 20px;
  height: 20px;
}

.vip-pay-status.is-expired .vip-pay-ic {
  background: #e2e8f0;
  color: #64748b;
}

.vip-pay-main {
  flex: 1;
  min-width: 0;
}

.vip-pay-main b {
  font-size: 14px;
  color: #0f172a;
}

.vip-pay-main span {
  display: block;
  font-size: 12px;
  color: #64748b;
  margin-top: 2px;
}

/* 待支付订单卡 */
.pay-order {
  display: flex;
  padding: 20px;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.05);
  margin-bottom: 16px;
}

.po-label {
  color: #94a3b8;
  font-size: 12px;
}

.po-amount {
  font-size: 28px;
  font-weight: 800;
  color: #2563eb;
  margin: 2px 0;
}

.po-amount.done {
  font-size: 20px;
  color: #16a34a;
}

.po-meta {
  color: #94a3b8;
  font-size: 12px;
}

.po-actions {
  display: flex;
  gap: 10px;
  flex: 0 0 auto;
}

/* 面板 */
.panel {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #fff;
  margin-bottom: 16px;
  overflow: hidden;
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid #f1f5f9;
}

.panel-head h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}

.panel-head .sub {
  font-size: 12px;
  color: #94a3b8;
}

.panel-body {
  padding: 18px;
}

/* 表格 */
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.data-table th,
.data-table td {
  padding: 11px 12px;
  text-align: left;
  border-bottom: 1px solid #f1f5f9;
}

.data-table th {
  background: #f8fafc;
  color: #475569;
  font-weight: 600;
}

.data-table td.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: #475569;
}

.data-table td.num {
  font-weight: 600;
  color: #0f172a;
}

.data-table td.muted,
.data-table td.empty {
  color: #94a3b8;
}

.data-table td.empty {
  text-align: center;
  padding: 28px 0;
}

.status {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}

.status.success {
  color: #16a34a;
  background: #f0fdf4;
}

.status.warning {
  color: #b45309;
  background: #fffbeb;
}

.status.danger {
  color: #dc2626;
  background: #fef2f2;
}

.status.muted {
  color: #64748b;
  background: #f1f5f9;
}

/* 按钮 */
.btn {
  height: 36px;
  padding: 0 16px;
  border-radius: 9px;
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #475569;
  font-size: 13px;
  cursor: pointer;
}

.btn:hover {
  border-color: #2563eb;
  color: #2563eb;
}

.btn.primary {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
  font-weight: 600;
}

.btn.primary:hover {
  background: #1d4ed8;
  color: #fff;
}

.btn.sm {
  height: 30px;
  padding: 0 12px;
  font-size: 12.5px;
}

.btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
</style>
