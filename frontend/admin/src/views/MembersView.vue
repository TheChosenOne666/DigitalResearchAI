<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHead from '@/components/PageHead.vue';
import { ApiError } from '@/api/http';
import {
  fetchPlans,
  createPlan,
  updatePlan,
  setPlanEnabled,
  fetchOrders,
  fetchRenewals,
  sendRenewal,
  batchRenewal,
} from '@/api/admin';
import type { AdminPlanRow, AdminOrderRow, AdminRenewalRow } from '@/api/admin';

/** 金额（分）→ 元 */
function money(cents: number): string {
  return `¥${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const LEVEL_LABEL: Record<string, string> = { PRO: '专业版', ENTERPRISE: '企业版' };
const CYCLE_LABEL: Record<string, string> = { SINGLE: '单月', MONTHLY: '连续包月', YEAR: '年付' };

// ===== 会员等级 =====
const plans = ref<AdminPlanRow[]>([]);
const plansLoading = ref(false);

async function loadPlans() {
  plansLoading.value = true;
  try {
    plans.value = await fetchPlans();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '加载会员等级失败');
  } finally {
    plansLoading.value = false;
  }
}

const planDialogVisible = ref(false);
const planMode = ref<'create' | 'edit'>('create');
const planId = ref('');
const planSaving = ref(false);
const planForm = reactive({
  code: '',
  level: 'PRO',
  cycle: 'YEAR',
  name: '',
  tag: '',
  badge: '',
  priceCents: 0,
  originPriceCents: null as number | null,
  features: [] as string[],
  sort: 0,
});

function openCreatePlan() {
  planMode.value = 'create';
  planId.value = '';
  Object.assign(planForm, {
    code: '', level: 'PRO', cycle: 'YEAR', name: '', tag: '', badge: '',
    priceCents: 0, originPriceCents: null, features: [], sort: 0,
  });
  planDialogVisible.value = true;
}

function openEditPlan(row: AdminPlanRow) {
  planMode.value = 'edit';
  planId.value = row.id;
  Object.assign(planForm, {
    code: row.code,
    level: row.level,
    cycle: row.cycle,
    name: row.name,
    tag: row.tag ?? '',
    badge: row.badge ?? '',
    priceCents: row.priceCents,
    originPriceCents: row.originPriceCents,
    features: [...row.features],
    sort: row.sort,
  });
  planDialogVisible.value = true;
}

async function onSavePlan() {
  if (!planForm.name || planForm.priceCents < 0) {
    ElMessage.warning('请填写等级名称与价格');
    return;
  }
  planSaving.value = true;
  try {
    if (planMode.value === 'create') {
      if (!planForm.code) {
        ElMessage.warning('请填写套餐编码');
        planSaving.value = false;
        return;
      }
      await createPlan({
        code: planForm.code,
        level: planForm.level,
        cycle: planForm.cycle,
        name: planForm.name,
        tag: planForm.tag || undefined,
        badge: planForm.badge || undefined,
        priceCents: planForm.priceCents,
        originPriceCents: planForm.originPriceCents ?? undefined,
        features: planForm.features.filter(Boolean),
        sort: planForm.sort,
      });
      ElMessage.success('等级已创建');
    } else {
      await updatePlan(planId.value, {
        level: planForm.level,
        cycle: planForm.cycle,
        name: planForm.name,
        tag: planForm.tag || undefined,
        badge: planForm.badge || undefined,
        priceCents: planForm.priceCents,
        originPriceCents: planForm.originPriceCents ?? undefined,
        features: planForm.features.filter(Boolean),
        sort: planForm.sort,
      });
      ElMessage.success('等级已更新');
    }
    planDialogVisible.value = false;
    void loadPlans();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '保存失败');
  } finally {
    planSaving.value = false;
  }
}

async function onTogglePlan(row: AdminPlanRow) {
  const actionText = row.enabled ? '停用' : '启用';
  try {
    await ElMessageBox.confirm(`确认${actionText}「${row.name}」？`, `${actionText}等级`, {
      type: 'warning',
      confirmButtonText: actionText,
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await setPlanEnabled(row.id, !row.enabled);
    ElMessage.success(`已${actionText}`);
    void loadPlans();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : `${actionText}失败`);
  }
}

// ===== 缴费订单 =====
const orders = ref<AdminOrderRow[]>([]);
const ordersTotal = ref(0);
const ordersLoading = ref(false);
const orderQuery = reactive({ status: '', keyword: '', page: 1, pageSize: 10 });

async function loadOrders() {
  ordersLoading.value = true;
  try {
    const res = await fetchOrders(orderQuery);
    orders.value = res.list;
    ordersTotal.value = res.total;
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '加载订单失败');
  } finally {
    ordersLoading.value = false;
  }
}

function onOrderPageChange(p: number) {
  orderQuery.page = p;
  void loadOrders();
}

const ORDER_STATUS: Record<string, { text: string; type: 'success' | 'warning' | 'danger' | 'info' }> = {
  PENDING: { text: '待支付', type: 'warning' },
  PAID: { text: '已支付', type: 'success' },
  CANCELLED: { text: '已取消', type: 'info' },
  CLOSED: { text: '已关闭', type: 'info' },
  FAILED: { text: '回调异常', type: 'danger' },
  REFUNDED: { text: '已退款', type: 'info' },
};

// ===== 续费提醒 =====
const renewals = ref<AdminRenewalRow[]>([]);
const renewalsLoading = ref(false);

async function loadRenewals() {
  renewalsLoading.value = true;
  try {
    renewals.value = await fetchRenewals();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '加载续费提醒失败');
  } finally {
    renewalsLoading.value = false;
  }
}

async function onSendRenewal(row: AdminRenewalRow) {
  try {
    await sendRenewal(row.userId);
    ElMessage.success('续费提醒已发送');
    void loadRenewals();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '发送失败');
  }
}

async function onBatchRenewal() {
  const pending = renewals.value.filter((r) => !r.reminded);
  if (pending.length === 0) {
    ElMessage.info('当前没有待提醒的会员');
    return;
  }
  try {
    await ElMessageBox.confirm(`确认向 ${pending.length} 位会员批量发送续费提醒？`, '批量提醒', {
      type: 'warning',
      confirmButtonText: '发送',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    const res = await batchRenewal(pending.map((r) => r.userId));
    ElMessage.success(`已向 ${res.sent} 位会员发送提醒`);
    void loadRenewals();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '批量发送失败');
  }
}

onMounted(() => {
  void loadPlans();
  void loadOrders();
  void loadRenewals();
});
</script>

<template>
  <div class="members-page">
    <PageHead title="会员等级与缴费管理" desc="管理会员等级、缴费与续费（PRD A-03）" :tags="['等级名称', '有效期', '价格', '缴费订单', '续费提醒']" />

    <!-- 会员等级 -->
    <div class="panel">
      <div class="panel-head">
        <h2>会员等级</h2>
        <div class="head-actions">
          <span class="sub">维护等级名称 / 有效期 / 价格</span>
          <el-button type="primary" size="small" @click="openCreatePlan">新增等级</el-button>
        </div>
      </div>
      <div class="panel-body">
        <el-table v-loading="plansLoading" :data="plans" style="width: 100%">
          <el-table-column label="等级名称" min-width="180">
            <template #default="{ row }">
              <span class="cell-strong">{{ row.name }}</span>
              <el-tag v-if="row.badge" size="small" type="warning" effect="light" class="badge-tag">{{ row.badge }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="等级" width="100">
            <template #default="{ row }">{{ LEVEL_LABEL[row.level] ?? row.level }}</template>
          </el-table-column>
          <el-table-column label="有效期" width="110">
            <template #default="{ row }">{{ CYCLE_LABEL[row.cycle] ?? row.cycle }}</template>
          </el-table-column>
          <el-table-column label="价格" min-width="130">
            <template #default="{ row }">
              <span class="price">{{ money(row.priceCents) }}</span>
              <span v-if="row.originPriceCents" class="origin-price">{{ money(row.originPriceCents) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <span class="status-dot" :class="row.enabled ? 'on' : 'off'"></span>
              {{ row.enabled ? '启用' : '停用' }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openEditPlan(row)">编辑</el-button>
              <el-button link :type="row.enabled ? 'danger' : 'success'" @click="onTogglePlan(row)">
                {{ row.enabled ? '停用' : '启用' }}
              </el-button>
            </template>
          </el-table-column>
          <template #empty><div class="empty-state">暂无会员等级</div></template>
        </el-table>
        <div class="small muted mt12">等级权益体系后续迭代；缴费成功与支付中心（U-16/A-20）联动，缴费后会员生效。</div>
      </div>
    </div>

    <!-- 缴费订单 + 续费提醒 -->
    <div class="grid-2">
      <div class="panel">
        <div class="panel-head"><h2>缴费订单</h2><span class="sub">用户 · 等级 · 金额 · 支付状态</span></div>
        <div class="panel-body">
          <div class="toolbar">
            <el-select v-model="orderQuery.status" placeholder="全部状态" clearable class="filter-select" @change="() => { orderQuery.page = 1; loadOrders(); }">
              <el-option v-for="(v, k) in ORDER_STATUS" :key="k" :label="v.text" :value="k" />
            </el-select>
          </div>
          <el-table v-loading="ordersLoading" :data="orders" style="width: 100%" size="small">
            <el-table-column label="用户" min-width="120">
              <template #default="{ row }">{{ row.user?.username ?? row.user?.nickname ?? '—' }}</template>
            </el-table-column>
            <el-table-column label="等级" min-width="120">
              <template #default="{ row }">{{ row.levelName }} · {{ row.cycleName }}</template>
            </el-table-column>
            <el-table-column label="金额" width="90">
              <template #default="{ row }"><span class="price-sm">{{ money(row.amountCents) }}</span></template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="ORDER_STATUS[row.status]?.type ?? 'info'" size="small" effect="light">
                  {{ ORDER_STATUS[row.status]?.text ?? row.status }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="时间" width="100">
              <template #default="{ row }">{{ (row.createdAt ?? '').slice(0, 10) }}</template>
            </el-table-column>
            <template #empty><div class="empty-state">暂无缴费订单</div></template>
          </el-table>
          <div class="pager">
            <el-pagination background layout="total, prev, pager, next" :total="ordersTotal" :page-size="orderQuery.pageSize" :current-page="orderQuery.page" @current-change="onOrderPageChange" />
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>续费提醒</h2><span class="sub">到期前 7 天触发 · 联动 A-09 消息管理</span></div>
        <div class="panel-body">
          <div v-loading="renewalsLoading" class="renew-list">
            <div v-for="r in renewals" :key="r.userId" class="renew-item">
              <span class="dot warn"></span>
              <div class="renew-text">
                <strong>{{ r.user?.username ?? r.user?.nickname ?? '—' }} · {{ r.levelName }}</strong>
                <div class="small muted">剩余 {{ r.daysLeft }} 天 · 状态：{{ r.reminded ? '已提醒' : '待提醒' }}</div>
              </div>
              <el-button v-if="!r.reminded" link type="primary" @click="onSendRenewal(r)">发送</el-button>
              <span v-else class="muted">已提醒</span>
            </div>
            <div v-if="renewals.length === 0" class="empty-state">7 天内无到期会员</div>
          </div>
          <el-button class="batch-btn" size="small" @click="onBatchRenewal">批量发起提醒</el-button>
        </div>
      </div>
    </div>

    <!-- 新增/编辑等级弹窗 -->
    <el-dialog v-model="planDialogVisible" :title="planMode === 'create' ? '新增会员等级' : '编辑会员等级'" width="480px" :close-on-click-modal="false">
      <el-form label-width="88px" label-position="left">
        <el-form-item label="套餐编码" :required="planMode === 'create'">
          <el-input v-model="planForm.code" :disabled="planMode === 'edit'" maxlength="32" placeholder="如 PRO_YEAR（编辑不可改）" />
        </el-form-item>
        <el-form-item label="等级">
          <el-select v-model="planForm.level" style="width: 100%">
            <el-option label="专业版" value="PRO" />
            <el-option label="企业版" value="ENTERPRISE" />
          </el-select>
        </el-form-item>
        <el-form-item label="有效期">
          <el-select v-model="planForm.cycle" style="width: 100%">
            <el-option label="单月" value="SINGLE" />
            <el-option label="连续包月" value="MONTHLY" />
            <el-option label="年付" value="YEAR" />
          </el-select>
        </el-form-item>
        <el-form-item label="等级名称" required>
          <el-input v-model="planForm.name" maxlength="64" placeholder="如：专业版 · 年付" />
        </el-form-item>
        <el-form-item label="价格（元）" required>
          <el-input-number v-model="planForm.priceCents" :min="0" :step="1" style="width: 100%" />
        </el-form-item>
        <el-form-item label="划线原价">
          <el-input-number v-model="planForm.originPriceCents" :min="0" :step="1" style="width: 100%" placeholder="仅年付展示" />
        </el-form-item>
        <el-form-item label="卖点标签">
          <el-input v-model="planForm.tag" maxlength="64" placeholder="如：个人研究首选" />
        </el-form-item>
        <el-form-item label="周期角标">
          <el-input v-model="planForm.badge" maxlength="32" placeholder="如：最推荐" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="planDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="planSaving" @click="onSavePlan">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.panel {
  background: #fff;
  border: 1px solid #eef2f7;
  border-radius: 14px;
  overflow: hidden;
  margin-bottom: 16px;
}
.panel-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px 0; }
.panel-head h2 { margin: 0; font-size: 15px; font-weight: 600; color: #0f172a; }
.panel-head .sub { font-size: 12px; color: #94a3b8; }
.panel-body { padding: 16px 20px 20px; }
.head-actions { display: flex; align-items: center; gap: 12px; }

.grid-2 { display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 16px; align-items: start; }
@media (max-width: 1100px) { .grid-2 { grid-template-columns: 1fr; } }

.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.filter-select { width: 140px; }

.cell-strong { font-weight: 600; color: #1e293b; }
.badge-tag { margin-left: 8px; }
.price { font-weight: 600; color: #e6a23c; }
.origin-price { margin-left: 8px; font-size: 12px; color: #94a3b8; text-decoration: line-through; }
.price-sm { font-weight: 600; color: #1e293b; }

.status-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; vertical-align: 1px; }
.status-dot.on { background: #67c23a; }
.status-dot.off { background: #f56c6c; }

.pager { display: flex; justify-content: flex-end; margin-top: 12px; }

.renew-list { display: flex; flex-direction: column; gap: 14px; min-height: 120px; }
.renew-item { display: flex; align-items: center; gap: 12px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #67c23a; flex-shrink: 0; }
.dot.warn { background: #e6a23c; }
.renew-text { flex: 1; }
.renew-text strong { font-size: 13px; color: #1e293b; font-weight: 600; }
.renew-text .small { margin-top: 3px; }
.batch-btn { margin-top: 16px; width: 100%; }

.small { font-size: 12px; }
.muted { color: #94a3b8; }
.mt12 { margin-top: 12px; }
.empty-state { padding: 24px 0; color: #94a3b8; font-size: 13px; text-align: center; }
</style>
