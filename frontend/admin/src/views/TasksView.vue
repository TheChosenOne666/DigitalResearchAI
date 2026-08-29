<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHead from '@/components/PageHead.vue';
import { ApiError } from '@/api/http';
import { fetchTasks, retryTask, stopTask, fetchTaskLogs } from '@/api/admin';
import type { AdminTaskRow, AdminTaskLogRow } from '@/api/admin';

const TASK_TYPE_LABEL: Record<string, string> = {
  SEARCH: '检索',
  COLLECT: '采集',
  ANALYZE: '分析',
  REPORT: '报告',
  INDEX: '索引',
  BACKUP: '备份',
};

const TASK_STATUS_LABEL: Record<string, string> = {
  WAITING: '待执行',
  RUNNING: '执行中',
  SUCCESS: '成功',
  FAILED: '失败',
  STOPPED: '已终止',
};

const TASK_STATUS_TAG: Record<string, 'info' | 'warning' | 'success' | 'danger'> = {
  WAITING: 'info',
  RUNNING: 'warning',
  SUCCESS: 'success',
  FAILED: 'danger',
  STOPPED: 'info',
};

const query = reactive({ type: '', status: '', keyword: '', page: 1, pageSize: 20 });
const loading = ref(false);
const list = ref<AdminTaskRow[]>([]);
const total = ref(0);

async function load() {
  loading.value = true;
  try {
    const res = await fetchTasks(query);
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

function canRetry(row: AdminTaskRow) {
  return row.status === 'FAILED' && row.retryCount < 3;
}

function canStop(row: AdminTaskRow) {
  return row.status === 'WAITING' || row.status === 'RUNNING';
}

async function onRetry(row: AdminTaskRow) {
  try {
    await retryTask(row.id);
    ElMessage.success(`任务 ${row.taskNo} 已重新入队`);
    void load();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '重试失败');
  }
}

async function onStop(row: AdminTaskRow) {
  try {
    await ElMessageBox.confirm(`终止任务「${row.taskNo}」？终止不可逆，请谨慎操作。`, '终止任务', {
      type: 'warning',
      confirmButtonText: '确认终止',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await stopTask(row.id);
    ElMessage.success(`任务 ${row.taskNo} 已终止`);
    void load();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '终止失败');
  }
}

// ===== 错误日志面板 =====
const logsLoading = ref(false);
const logsTask = ref<AdminTaskRow | null>(null);
const logs = ref<AdminTaskLogRow[]>([]);

async function showLogs(row: AdminTaskRow) {
  logsTask.value = row;
  logsLoading.value = true;
  try {
    const res = await fetchTaskLogs(row.id);
    logs.value = res.logs;
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '日志加载失败');
  } finally {
    logsLoading.value = false;
  }
}

function fmtTime(v: string) {
  return new Date(v).toLocaleString('zh-CN', { hour12: false });
}

onMounted(() => void load());
</script>

<template>
  <div class="tasks-page">
    <PageHead title="后台任务监控" desc="管理检索、采集、分析和报告任务（PRD A-11）" :tags="['状态', '进度', '重试', '终止', '错误日志']" />

    <div class="panel mb16">
      <div class="panel-body">
        <div class="toolbar">
          <el-select v-model="query.type" class="w140" clearable placeholder="全部任务类型" @change="onSearch">
            <el-option v-for="(label, key) in TASK_TYPE_LABEL" :key="key" :label="label" :value="key" />
          </el-select>
          <el-select v-model="query.status" class="w140" clearable placeholder="全部状态" @change="onSearch">
            <el-option v-for="(label, key) in TASK_STATUS_LABEL" :key="key" :label="label" :value="key" />
          </el-select>
          <el-input v-model="query.keyword" class="search-input" placeholder="任务 ID / 用户" clearable @keyup.enter="onSearch" @clear="onSearch">
            <template #prefix>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="1.8" /><path d="m16 16 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
            </template>
          </el-input>
          <span class="spacer"></span>
          <el-button size="small" @click="onSearch">刷新</el-button>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>任务列表</h2><span class="sub">与用户端 U-04 状态机一致 · 重试上限 3 次</span></div>
      <div class="panel-body">
        <el-table v-loading="loading" :data="list" style="width: 100%">
          <el-table-column label="任务 ID" width="180">
            <template #default="{ row }"><span class="cell-strong">{{ row.taskNo }}</span></template>
          </el-table-column>
          <el-table-column label="类型" width="90">
            <template #default="{ row }">
              <el-tag :type="row.type === 'SEARCH' ? 'primary' : 'info'" effect="light" size="small">{{ TASK_TYPE_LABEL[row.type] ?? row.type }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="用户" width="130">
            <template #default="{ row }">{{ row.user ?? '系统' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="TASK_STATUS_TAG[row.status]" effect="light" size="small">{{ TASK_STATUS_LABEL[row.status] ?? row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="进度" min-width="190">
            <template #default="{ row }">
              <div v-if="row.status === 'RUNNING' || row.status === 'WAITING'" class="progress-wrap">
                <div class="progress"><i :style="{ width: row.progress + '%' }"></i></div>
                <span class="pct">{{ row.progress }}%{{ row.stage ? ` · ${row.stage}` : '' }}</span>
              </div>
              <span v-else-if="row.status === 'SUCCESS'" class="pct">100%</span>
              <span v-else class="pct muted">—</span>
            </template>
          </el-table-column>
          <el-table-column label="创建时间" width="170">
            <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="170" fixed="right">
            <template #default="{ row }">
              <el-button v-if="canRetry(row)" link type="primary" @click="onRetry(row)">重试</el-button>
              <el-button v-if="canStop(row)" link type="danger" @click="onStop(row)">终止</el-button>
              <el-button link type="primary" @click="showLogs(row)">日志</el-button>
              <el-button v-if="row.status === 'FAILED' && row.retryCount >= 3" link type="info" disabled>已达重试上限</el-button>
            </template>
          </el-table-column>
          <template #empty><div class="empty-state">暂无任务数据</div></template>
        </el-table>

        <div class="alert danger mt12">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
          任务执行超过「超时」参数（A-12）且无进度更新时自动标记为异常，可重试/终止；终止不可逆需二次确认。
        </div>

        <div class="pager">
          <el-pagination background layout="total, prev, pager, next" :total="total" :page-size="query.pageSize" :current-page="query.page" @current-change="onPageChange" />
        </div>
      </div>
    </div>

    <div class="panel mt16">
      <div class="panel-head"><h2>错误日志{{ logsTask ? ` · ${logsTask.taskNo}` : '' }}</h2><span class="sub">辅助排查</span></div>
      <div class="panel-body">
        <el-table v-loading="logsLoading" :data="logs" style="width: 100%">
          <el-table-column label="时间" width="180">
            <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="级别" width="100">
            <template #default="{ row }">
              <el-tag :type="row.level === 'ERROR' ? 'danger' : row.level === 'WARN' ? 'warning' : 'info'" effect="light" size="small">{{ row.level }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="错误信息" min-width="300">
            <template #default="{ row }"><span class="small">{{ row.message }}</span></template>
          </el-table-column>
          <template #empty><div class="empty-state">{{ logsTask ? '该任务暂无日志' : '点击任务行的「日志」查看错误日志' }}</div></template>
        </el-table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel { background: #fff; border: 1px solid #eef2f7; border-radius: 14px; overflow: hidden; margin-bottom: 16px; }
.panel.mt16 { margin-top: 0; }
.panel-head { display: flex; align-items: baseline; gap: 10px; padding: 14px 20px 0; }
.panel-head h2 { font-size: 15px; font-weight: 600; color: #1e293b; margin: 0; }
.panel-head .sub { font-size: 12px; color: #94a3b8; }
.panel-body { padding: 14px 20px 20px; }
.mb16 { margin-bottom: 16px; }
.toolbar { display: flex; align-items: center; gap: 10px; }
.search-input { width: 220px; }
.w140 { width: 140px; }
.spacer { flex: 1; }
.cell-strong { font-weight: 600; color: #1e293b; }
.muted { color: #94a3b8; }
.small { font-size: 12px; color: #475569; }
.progress-wrap { display: flex; align-items: center; gap: 8px; }
.progress { width: 130px; height: 6px; border-radius: 3px; background: #eef2f7; overflow: hidden; flex: none; }
.progress i { display: block; height: 100%; border-radius: 3px; background: #409eff; transition: width 0.3s; }
.pct { font-size: 12px; color: #475569; white-space: nowrap; }
.alert { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 10px; font-size: 12.5px; }
.alert.danger { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
.mt12 { margin-top: 12px; }
.pager { display: flex; justify-content: flex-end; margin-top: 16px; }
.empty-state { padding: 32px 0; color: #94a3b8; font-size: 13px; }
</style>
