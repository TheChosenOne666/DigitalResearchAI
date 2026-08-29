<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHead from '@/components/PageHead.vue';
import { ApiError } from '@/api/http';
import { fetchPayOrders, refundPayOrder, closePayOrder, fetchPayChannels, updatePayChannel, updatePayChannelKey } from '@/api/admin';
import type { PayOrderRow, PayChannelRow } from '@/api/admin';

const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: '待支付',
  PAID: '已支付',
  REFUNDED: '已退款',
  CLOSED: '已关闭',
  FAILED: '回调异常',
  CANCELLED: '已取消',
};
const ORDER_STATUS_TAG: Record<string, 'info' | 'warning' | 'success' | 'danger'> = {
  PENDING: 'warning',
  PAID: 'success',
  REFUNDED: 'info',
  CLOSED: 'info',
  FAILED: 'danger',
  CANCELLED: 'info',
};
const CHANNEL_LABEL: Record<string, string> = { MOCK: '模拟支付', WECHAT: '微信支付', ALIPAY: '支付宝' };

const activeTab = ref('orders');

// ===== Tab1 订单管理 =====
const query = reactive({ status: '', channel: '', keyword: '', page: 1, pageSize: 20 });
const loading = ref(false);
const list = ref<PayOrderRow[]>([]);
const total = ref(0);

async function load() {
  loading.value = true;
  try {
    const res = await fetchPayOrders(query);
    list.value = res.list;
    total.value = res.total;
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '加载失败');
  } finally {
    loading.value = false;
  }
}

function onSearch() {
  query.page = 1;
  void load();
}

function onPageChange(p: number) {
  query.page = p;
  void load();
}

function fmtMoney(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`;
}

function fmtTime(v: string | null) {
  if (!v) return '—';
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function onRefund(row: PayOrderRow) {
  let reason: string;
  try {
    const res = await ElMessageBox.prompt(
      `退款需二次确认并记录原因。确认退还订单「${row.orderNo}」金额 ${fmtMoney(row.amountCents)}？退款后订单状态更新为「已退款」并同步用户端。`,
      `退款 · ${row.orderNo}`,
      {
        type: 'warning',
        confirmButtonText: '确认退款',
        cancelButtonText: '取消',
        inputPlaceholder: '例如：用户重复支付',
        inputValidator: (v: string) => (v && v.trim().length >= 2 ? true : '退款原因至少 2 个字符'),
      },
    );
    reason = res.value.trim();
  } catch {
    return;
  }
  try {
    await refundPayOrder(row.orderNo, reason);
    ElMessage.success(`订单 ${row.orderNo} 已退款`);
    void load();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '退款失败');
  }
}

async function onClose(row: PayOrderRow) {
  try {
    await ElMessageBox.confirm(`确认关闭订单「${row.orderNo}」？关闭后用户不可继续支付。`, '关闭订单', {
      type: 'warning',
      confirmButtonText: '确认关闭',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await closePayOrder(row.orderNo);
    ElMessage.success(`订单 ${row.orderNo} 已关闭`);
    void load();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '关闭失败');
  }
}

// ===== Tab2 支付渠道配置 =====
const channels = ref<PayChannelRow[]>([]);
const channelsLoading = ref(false);

async function loadChannels() {
  channelsLoading.value = true;
  try {
    channels.value = await fetchPayChannels();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '渠道加载失败');
  } finally {
    channelsLoading.value = false;
  }
}

const channelDialog = ref(false);
const channelSaving = ref(false);
const channelForm = ref<{ id: string; channel: string; merchantId: string; notifyUrl: string }>({ id: '', channel: '', merchantId: '', notifyUrl: '' });

function openChannel(row: PayChannelRow) {
  channelForm.value = { id: row.id, channel: row.channel, merchantId: row.merchantId ?? '', notifyUrl: row.notifyUrl ?? '' };
  channelDialog.value = true;
}

async function saveChannel() {
  channelSaving.value = true;
  try {
    await updatePayChannel(channelForm.value.id, {
      merchantId: channelForm.value.merchantId.trim() || null,
      notifyUrl: channelForm.value.notifyUrl.trim() || null,
    });
    ElMessage.success(`渠道 ${CHANNEL_LABEL[channelForm.value.channel] ?? channelForm.value.channel} 已更新`);
    channelDialog.value = false;
    void loadChannels();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '保存失败');
  } finally {
    channelSaving.value = false;
  }
}

async function toggleChannel(row: PayChannelRow) {
  try {
    await updatePayChannel(row.id, { enabled: !row.enabled });
    ElMessage.success(`渠道 ${CHANNEL_LABEL[row.channel] ?? row.channel} 已${row.enabled ? '停用' : '启用'}`);
    void loadChannels();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '操作失败');
  }
}

const keyDialog = ref(false);
const keySaving = ref(false);
const keyForm = ref<{ id: string; channel: string; secret: string }>({ id: '', channel: '', secret: '' });

function openKey(row: PayChannelRow) {
  keyForm.value = { id: row.id, channel: row.channel, secret: '' };
  keyDialog.value = true;
}

async function saveKey() {
  if (keyForm.value.secret.length < 6) {
    ElMessage.warning('密钥至少 6 位');
    return;
  }
  keySaving.value = true;
  try {
    await updatePayChannelKey(keyForm.value.id, keyForm.value.secret);
    ElMessage.success('密钥已加密存储（不显示明文，操作已落审计日志）');
    keyDialog.value = false;
    void loadChannels();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '保存失败');
  } finally {
    keySaving.value = false;
  }
}

function fmtKeyTime(v: string | null) {
  if (!v) return '从未设置';
  return new Date(v).toLocaleString('zh-CN', { hour12: false });
}

onMounted(() => {
  void load();
  void loadChannels();
});
</script>

<template>
  <div class="orders-page">
    <PageHead title="订单与支付渠道管理" desc="管理支付订单与支付渠道（PRD A-20）" :tags="['订单查询', '退款', '关闭', '渠道配置', '密钥管理']" />

    <el-tabs v-model="activeTab">
      <el-tab-pane label="订单管理" name="orders">
        <div class="panel mb16">
          <div class="panel-body">
            <div class="toolbar">
              <el-input v-model="query.keyword" class="search-input" placeholder="订单号 / 用户" clearable @keyup.enter="onSearch" @clear="onSearch">
                <template #prefix>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="1.8" /><path d="m16 16 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
                </template>
              </el-input>
              <el-select v-model="query.status" class="w140" clearable placeholder="全部状态" @change="onSearch">
                <el-option v-for="(label, key) in ORDER_STATUS_LABEL" :key="key" :label="label" :value="key" />
              </el-select>
              <el-select v-model="query.channel" class="w140" clearable placeholder="全部类型" @change="onSearch">
                <el-option v-for="(label, key) in CHANNEL_LABEL" :key="key" :label="label" :value="key" />
              </el-select>
              <span class="spacer"></span>
              <el-button size="small" @click="onSearch">刷新</el-button>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h2>订单列表</h2><span class="sub">跨租户 · 共 {{ total }} 笔</span></div>
          <div class="panel-body">
            <el-table v-loading="loading" :data="list" style="width: 100%">
              <el-table-column label="订单号" width="175">
                <template #default="{ row }"><span class="cell-strong">{{ row.orderNo }}</span></template>
              </el-table-column>
              <el-table-column label="用户" width="90">
                <template #default="{ row }">{{ row.user ?? '—' }}</template>
              </el-table-column>
              <el-table-column label="套餐" min-width="130">
                <template #default="{ row }">
                  <div>{{ row.planName }}<span class="small muted"> · {{ row.cycleName }}</span><el-tag v-if="row.isRenewal" size="small" effect="plain" class="ml8">续费</el-tag></div>
                </template>
              </el-table-column>
              <el-table-column label="金额" width="95" align="right">
                <template #default="{ row }"><span class="cell-strong num">{{ fmtMoney(row.amountCents) }}</span></template>
              </el-table-column>
              <el-table-column label="渠道" width="95">
                <template #default="{ row }">
                  <el-tag type="primary" effect="light" size="small">{{ CHANNEL_LABEL[row.channel] ?? row.channel }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="95">
                <template #default="{ row }">
                  <el-tag :type="ORDER_STATUS_TAG[row.status] ?? 'info'" effect="light" size="small">{{ ORDER_STATUS_LABEL[row.status] ?? row.status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="时间" width="150">
                <template #default="{ row }">{{ fmtTime(row.paidAt ?? row.createdAt) }}</template>
              </el-table-column>
              <el-table-column label="操作" width="105" fixed="right">
                <template #default="{ row }">
                  <el-button v-if="row.status === 'PAID'" link type="danger" @click="onRefund(row)">退款</el-button>
                  <el-button v-if="row.status === 'PENDING' || row.status === 'FAILED'" link type="danger" @click="onClose(row)">关闭</el-button>
                  <span v-if="row.status === 'REFUNDED'" class="small muted">已退款</span>
                </template>
              </el-table-column>
              <template #empty><div class="empty-state">暂无订单数据</div></template>
            </el-table>
            <div class="note">
              退款需二次确认并记录退款原因；退款后订单状态更新为「已退款」并同步用户端（U-17）；超时未支付订单自动关闭。
            </div>
            <div class="pager">
              <el-pagination background layout="total, prev, pager, next" :total="total" :page-size="query.pageSize" :current-page="query.page" @current-change="onPageChange" />
            </div>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="支付渠道配置" name="channels">
        <div class="panel mb16">
          <div class="panel-head"><h2>渠道配置</h2><span class="sub">商户号 · 回调地址 · 启停</span></div>
          <div class="panel-body">
            <el-table v-loading="channelsLoading" :data="channels" style="width: 100%">
              <el-table-column label="渠道" width="140">
                <template #default="{ row }">
                  <el-tag type="primary" effect="light" size="small">{{ CHANNEL_LABEL[row.channel] ?? row.channel }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="商户号" min-width="160">
                <template #default="{ row }">{{ row.merchantId ?? '—' }}</template>
              </el-table-column>
              <el-table-column label="回调地址" min-width="220">
                <template #default="{ row }"><span class="small">{{ row.notifyUrl || '—' }}</span></template>
              </el-table-column>
              <el-table-column label="状态" width="100">
                <template #default="{ row }">
                  <el-tag :type="row.enabled ? 'success' : 'info'" effect="light" size="small">{{ row.enabled ? '启用' : '停用' }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="130" fixed="right">
                <template #default="{ row }">
                  <el-button link type="primary" @click="openChannel(row)">编辑</el-button>
                  <el-button link :type="row.enabled ? 'danger' : 'success'" @click="toggleChannel(row)">{{ row.enabled ? '停用' : '启用' }}</el-button>
                </template>
              </el-table-column>
              <template #empty><div class="empty-state">暂无渠道配置</div></template>
            </el-table>
          </div>
        </div>

        <div class="panel mb16">
          <div class="panel-head"><h2>密钥管理</h2><span class="sub">加密存储 · 不显示明文 · 支持轮换</span></div>
          <div class="panel-body">
            <el-table v-loading="channelsLoading" :data="channels" style="width: 100%">
              <el-table-column label="渠道" width="140">
                <template #default="{ row }">
                  <el-tag type="primary" effect="light" size="small">{{ CHANNEL_LABEL[row.channel] ?? row.channel }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="密钥状态" width="120">
                <template #default="{ row }">
                  <el-tag :type="row.hasKey ? 'success' : 'warning'" effect="light" size="small">{{ row.hasKey ? '已配置' : '未配置' }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="上次轮换" min-width="180">
                <template #default="{ row }">{{ fmtKeyTime(row.keyUpdatedAt) }}</template>
              </el-table-column>
              <el-table-column label="操作" width="130" fixed="right">
                <template #default="{ row }">
                  <el-button link type="primary" @click="openKey(row)">{{ row.hasKey ? '更新密钥' : '设置密钥' }}</el-button>
                </template>
              </el-table-column>
              <template #empty><div class="empty-state">暂无渠道配置</div></template>
            </el-table>
            <div class="alert danger mt12">
              密钥不得明文展示（AES-256-GCM 加密存储，只写不读），操作留审计日志（A-13）；渠道回调失败/密钥失效时告警并进入人工排查。
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="channelDialog" :title="`编辑渠道 · ${CHANNEL_LABEL[channelForm.channel] ?? channelForm.channel}`" width="480px">
      <el-form label-width="90px">
        <el-form-item label="商户号">
          <el-input v-model="channelForm.merchantId" placeholder="渠道分配的商户号" maxlength="128" />
        </el-form-item>
        <el-form-item label="回调地址">
          <el-input v-model="channelForm.notifyUrl" placeholder="https://…/api/v1/pay/notify/…" maxlength="255" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="channelDialog = false">取消</el-button>
        <el-button type="primary" :loading="channelSaving" @click="saveChannel">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="keyDialog" :title="`更新密钥 · ${CHANNEL_LABEL[keyForm.channel] ?? keyForm.channel}`" width="480px">
      <el-form label-width="90px">
        <el-form-item label="渠道密钥">
          <el-input v-model="keyForm.secret" type="password" show-password placeholder="输入新密钥（至少 6 位），保存后加密存储" />
        </el-form-item>
      </el-form>
      <div class="note px20">密钥保存后立即生效并记录审计日志；历史明文不可查看，请妥善保管。</div>
      <template #footer>
        <el-button @click="keyDialog = false">取消</el-button>
        <el-button type="primary" :loading="keySaving" @click="saveKey">确认更新</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.panel { background: #fff; border: 1px solid #eef2f7; border-radius: 14px; overflow: hidden; margin-bottom: 16px; }
.panel-head { display: flex; align-items: baseline; gap: 10px; padding: 14px 20px 0; }
.panel-head h2 { font-size: 15px; font-weight: 600; color: #1e293b; margin: 0; }
.panel-head .sub { font-size: 12px; color: #94a3b8; }
.panel-body { padding: 14px 20px 20px; }
.mb16 { margin-bottom: 16px; }
.mt12 { margin-top: 12px; }
.px20 { padding: 0 20px; }
.toolbar { display: flex; align-items: center; gap: 10px; }
.search-input { width: 200px; }
.w140 { width: 140px; }
.spacer { flex: 1; }
.cell-strong { font-weight: 600; color: #1e293b; }
.num { font-variant-numeric: tabular-nums; }
.ml8 { margin-left: 8px; }
.muted { color: #94a3b8; }
.small { font-size: 12px; color: #475569; }
.note { margin-top: 12px; font-size: 12px; color: #94a3b8; }
.alert { padding: 10px 14px; border-radius: 10px; font-size: 12.5px; }
.alert.danger { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
.pager { display: flex; justify-content: flex-end; margin-top: 16px; }
.empty-state { padding: 32px 0; color: #94a3b8; font-size: 13px; }
</style>
