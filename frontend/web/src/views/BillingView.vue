<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import TopNav from '@/components/TopNav.vue';
import {
  fetchBillingOrders,
  fetchBillingPayments,
  money,
  dateTime,
  type MemberOrder,
  type PaymentItem,
} from '@/api/member';

/** 账单页签 */
const tab = ref<'orders' | 'payments'>('orders');

/** 筛选条件 */
const range = ref('all');
const status = ref('');

const loading = ref(false);
const orders = ref<MemberOrder[]>([]);
const payments = ref<PaymentItem[]>([]);

/** 时间范围选项（对齐原型「全部时间 / 近 30 天 / 近 90 天」） */
const RANGES = [
  { value: 'all', label: '全部时间' },
  { value: '30d', label: '近 30 天' },
  { value: '90d', label: '近 90 天' },
];

/** 状态选项（后端订单状态机） */
const STATUSES = [
  { value: '', label: '全部状态' },
  { value: 'PAID', label: '已支付' },
  { value: 'PENDING', label: '待支付' },
  { value: 'CANCELLED', label: '已取消' },
  { value: 'CLOSED', label: '已关闭' },
  { value: 'FAILED', label: '回调异常' },
];

async function load(): Promise<void> {
  loading.value = true;
  try {
    if (tab.value === 'orders') {
      const res = await fetchBillingOrders({
        range: range.value === 'all' ? undefined : range.value,
        status: status.value || undefined,
        page: 1,
        pageSize: 50,
      });
      orders.value = res.list;
    } else {
      const res = await fetchBillingPayments({ page: 1, pageSize: 50 });
      payments.value = res.list;
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '账单加载失败');
  } finally {
    loading.value = false;
  }
}

function switchTab(next: 'orders' | 'payments'): void {
  tab.value = next;
  load();
}

/** 状态标签配色 */
function statusClass(s: string): string {
  if (s === 'PAID' || s === 'SUCCESS') return 'success';
  if (s === 'PENDING') return 'warning';
  if (s === 'FAILED') return 'danger';
  return 'muted';
}

onMounted(load);
</script>

<template>
  <div class="bill-shell">
    <TopNav />
    <div class="bill-page">
      <div class="page-head">
        <div>
          <h1>账单查询</h1>
          <p>订单列表与支付流水</p>
        </div>
        <div class="filters">
          <select v-model="range" class="select" @change="load">
            <option v-for="r in RANGES" :key="r.value" :value="r.value">{{ r.label }}</option>
          </select>
          <select v-model="status" class="select" @change="load">
            <option v-for="s in STATUSES" :key="s.value" :value="s.value">{{ s.label }}</option>
          </select>
        </div>
      </div>

      <section class="panel">
        <div class="tabs">
          <button class="tab" :class="{ active: tab === 'orders' }" @click="switchTab('orders')">
            订单列表
          </button>
          <button class="tab" :class="{ active: tab === 'payments' }" @click="switchTab('payments')">
            支付流水
          </button>
        </div>
        <div v-loading="loading" class="panel-body">
          <!-- 订单列表 -->
          <table v-if="tab === 'orders'" class="data-table">
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

          <!-- 支付流水 -->
          <table v-else class="data-table">
            <thead>
              <tr>
                <th>流水号</th>
                <th>渠道</th>
                <th>订单号</th>
                <th>金额</th>
                <th>支付时间</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!payments.length">
                <td colspan="6" class="empty">暂无支付流水</td>
              </tr>
              <tr v-for="p in payments" :key="p.id">
                <td class="mono">{{ p.transactionNo }}</td>
                <td>{{ p.channel === 'MOCK' ? '模拟支付' : p.channel }}</td>
                <td class="mono">{{ p.orderNo }}</td>
                <td class="num">{{ money(p.amountCents) }}</td>
                <td class="muted">{{ dateTime(p.paidAt) }}</td>
                <td>
                  <span class="status" :class="statusClass(p.status)">
                    {{ p.status === 'SUCCESS' ? '成功' : '失败' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.bill-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f8fafc;
}

.bill-page {
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
  padding: 20px 24px 48px;
}

.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
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

.filters {
  display: flex;
  gap: 10px;
}

.select {
  height: 34px;
  padding: 0 10px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  color: #475569;
  font-size: 13px;
  cursor: pointer;
}

.panel {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
}

.tabs {
  display: flex;
  gap: 4px;
  padding: 0 12px;
  border-bottom: 1px solid #f1f5f9;
}

.tab {
  padding: 13px 16px;
  border: none;
  background: transparent;
  color: #64748b;
  font-size: 13.5px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}

.tab.active {
  color: #2563eb;
  font-weight: 600;
  border-bottom-color: #2563eb;
}

.panel-body {
  padding: 12px 18px 18px;
  min-height: 200px;
}

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
  padding: 40px 0;
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
</style>
