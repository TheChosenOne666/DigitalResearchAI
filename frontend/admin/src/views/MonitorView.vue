<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import PageHead from '@/components/PageHead.vue';
import { ApiError } from '@/api/http';
import { fetchMonitorHealth, fetchMonitorErrors } from '@/api/admin';
import type { MonitorErrorRow, MonitorServiceRow } from '@/api/admin';

/** 页面自身可达即视为前端服务正常（后端无法探测前端） */
const FRONT_SERVICE: MonitorServiceRow = { key: 'web', name: '前端 Web', address: typeof window !== 'undefined' ? window.location.origin : '—', status: 'up' };

const REFRESH_INTERVAL_MS = 60_000;

const checking = ref(false);
const checkedAt = ref('');
const services = ref<MonitorServiceRow[]>([]);
const errorsLoading = ref(false);
const errors = ref<MonitorErrorRow[]>([]);
const errorsTotal = ref(0);
const errorsQuery = reactive({ keyword: '', source: '', page: 1, pageSize: 10 });

const kpis = computed<MonitorServiceRow[]>(() => [FRONT_SERVICE, ...services.value]);

async function checkHealth(silent = false) {
  checking.value = true;
  try {
    const res = await fetchMonitorHealth();
    services.value = res.services;
    checkedAt.value = new Date(res.checkedAt).toLocaleString('zh-CN', { hour12: false });
    const down = res.services.filter((s) => s.status === 'down');
    if (!silent && down.length > 0) {
      ElMessage.warning(`异常服务：${down.map((s) => s.name).join('、')}`);
    }
  } catch (e) {
    if (!silent) ElMessage.error(e instanceof ApiError ? e.message : '健康检查失败');
  } finally {
    checking.value = false;
  }
}

async function loadErrors() {
  errorsLoading.value = true;
  try {
    const res = await fetchMonitorErrors(errorsQuery);
    errors.value = res.list;
    errorsTotal.value = res.total;
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '错误日志加载失败');
  } finally {
    errorsLoading.value = false;
  }
}

function onErrorsSearch() {
  errorsQuery.page = 1;
  void loadErrors();
}

function onErrorsPageChange(p: number) {
  errorsQuery.page = p;
  void loadErrors();
}

function fmtTime(v: string) {
  return new Date(v).toLocaleString('zh-CN', { hour12: false });
}

let timer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  void checkHealth(true);
  void loadErrors();
  timer = setInterval(() => void checkHealth(true), REFRESH_INTERVAL_MS);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div class="monitor-page">
    <PageHead title="服务监控" desc="监控前后端、数据库和外部服务（PRD A-14）" :tags="['健康检查', '错误日志']" />

    <div class="toolbar mb16">
      <span class="small muted">定时检查频率：1 分钟{{ checkedAt ? ` · 最近检查 ${checkedAt}` : '' }}</span>
      <span class="spacer"></span>
      <el-button size="small" :loading="checking" @click="checkHealth()">手动检查</el-button>
    </div>

    <div class="kpi-grid mb16">
      <div v-for="s in kpis" :key="s.key" class="kpi">
        <div>
          <div class="lbl">{{ s.name }}</div>
          <div class="val" :class="{ danger: s.status === 'down' }">{{ s.status === 'up' ? '正常' : '异常' }}</div>
        </div>
      </div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-head"><h2>服务健康看板</h2><span class="sub">正常 / 异常</span></div>
        <div class="panel-body">
          <el-table :data="kpis" style="width: 100%">
            <el-table-column label="服务" width="170">
              <template #default="{ row }"><span class="cell-strong">{{ row.name }}</span></template>
            </el-table-column>
            <el-table-column label="地址" min-width="180">
              <template #default="{ row }"><span class="small muted">{{ row.address }}</span></template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="row.status === 'up' ? 'success' : 'danger'" effect="light" size="small">{{ row.status === 'up' ? '正常' : '异常' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="最近检查" width="170">
              <template #default="{ row }">{{ row.key === 'web' ? '—' : checkedAt || '—' }}</template>
            </el-table-column>
          </el-table>
          <div class="small muted mt12">服务异常时在监控页展示告警标识；被监控服务不可达时置为异常并记录日志，不影响监控页面本身。</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>错误日志</h2><span class="sub">时间 · 服务 · 错误信息</span></div>
        <div class="panel-body">
          <div class="toolbar mb12">
            <el-input v-model="errorsQuery.keyword" class="search-input" placeholder="检索错误日志" clearable @keyup.enter="onErrorsSearch" @clear="onErrorsSearch">
              <template #prefix>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="1.8" /><path d="m16 16 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
              </template>
            </el-input>
            <el-select v-model="errorsQuery.source" class="w140" clearable placeholder="全部服务" @change="onErrorsSearch">
              <el-option label="后台任务" value="task" />
              <el-option label="敏感词拦截" value="sensitive" />
            </el-select>
          </div>
          <el-table v-loading="errorsLoading" :data="errors" style="width: 100%">
            <el-table-column label="时间" width="170">
              <template #default="{ row }">{{ fmtTime(row.time) }}</template>
            </el-table-column>
            <el-table-column label="服务" width="120">
              <template #default="{ row }">{{ row.service }}</template>
            </el-table-column>
            <el-table-column label="错误信息" min-width="220">
              <template #default="{ row }"><span class="small">{{ row.message }}</span></template>
            </el-table-column>
            <template #empty><div class="empty-state">暂无错误日志</div></template>
          </el-table>
          <div class="pager">
            <el-pagination small background layout="total, prev, pager, next" :total="errorsTotal" :page-size="errorsQuery.pageSize" :current-page="errorsQuery.page" @current-change="onErrorsPageChange" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbar { display: flex; align-items: center; gap: 10px; }
.mb16 { margin-bottom: 16px; }
.mb12 { margin-bottom: 12px; }
.spacer { flex: 1; }
.small { font-size: 12px; }
.muted { color: #94a3b8; }
.kpi-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
.kpi { background: #fff; border: 1px solid #eef2f7; border-radius: 14px; padding: 16px 18px; display: flex; justify-content: space-between; align-items: center; }
.kpi .lbl { font-size: 12px; color: #94a3b8; margin-bottom: 6px; }
.kpi .val { font-size: 18px; font-weight: 600; color: #16a34a; }
.kpi .val.danger { color: #dc2626; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.panel { background: #fff; border: 1px solid #eef2f7; border-radius: 14px; overflow: hidden; }
.panel-head { display: flex; align-items: baseline; gap: 10px; padding: 14px 20px 0; }
.panel-head h2 { font-size: 15px; font-weight: 600; color: #1e293b; margin: 0; }
.panel-head .sub { font-size: 12px; color: #94a3b8; }
.panel-body { padding: 14px 20px 20px; }
.cell-strong { font-weight: 600; color: #1e293b; }
.search-input { width: 200px; }
.w140 { width: 140px; }
.mt12 { margin-top: 12px; }
.pager { display: flex; justify-content: flex-end; margin-top: 12px; }
.empty-state { padding: 32px 0; color: #94a3b8; font-size: 13px; }
@media (max-width: 1200px) {
  .kpi-grid { grid-template-columns: repeat(3, 1fr); }
  .grid-2 { grid-template-columns: 1fr; }
}
</style>
