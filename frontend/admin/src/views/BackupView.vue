<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHead from '@/components/PageHead.vue';
import { ApiError } from '@/api/http';
import { fetchBackupPolicy, updateBackupPolicy, backupNow, fetchBackupRecords, restoreBackup } from '@/api/admin';
import type { BackupPolicy, BackupRecordRow } from '@/api/admin';

const SCOPE_OPTIONS = [
  { value: 'full', label: '全量（数据+配置）' },
  { value: 'data', label: '仅业务数据' },
  { value: 'config', label: '仅配置' },
];

const SCHEDULE_OPTIONS = [
  { value: 'daily', label: '每日 02:00' },
  { value: 'weekly', label: '每周日 02:00' },
  { value: 'monthly', label: '每月 1 日 02:00' },
];

const SCOPE_LABEL: Record<string, string> = { FULL: '全量', DATA: '业务数据', CONFIG: '配置' };

const policy = reactive<BackupPolicy>({ scope: 'full', schedule: 'daily', keep: 30 });
const policySaving = ref(false);
const backingUp = ref(false);

const recordsLoading = ref(false);
const records = ref<BackupRecordRow[]>([]);
const recordsTotal = ref(0);
const recordsPage = ref(1);

async function loadPolicy() {
  try {
    Object.assign(policy, await fetchBackupPolicy());
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '备份策略加载失败');
  }
}

async function onSavePolicy() {
  if (!Number.isInteger(policy.keep) || policy.keep < 1 || policy.keep > 365) {
    ElMessage.warning('保留份数需为 1 ~ 365 的整数');
    return;
  }
  policySaving.value = true;
  try {
    Object.assign(policy, await updateBackupPolicy({ ...policy }));
    ElMessage.success('备份策略已保存');
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '保存失败');
  } finally {
    policySaving.value = false;
  }
}

async function onBackupNow() {
  backingUp.value = true;
  try {
    await backupNow();
    ElMessage.success('备份任务已记录（演示环境不执行真实备份）');
    recordsPage.value = 1;
    void loadRecords();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '备份失败');
  } finally {
    backingUp.value = false;
  }
}

async function loadRecords() {
  recordsLoading.value = true;
  try {
    const res = await fetchBackupRecords(recordsPage.value, 20);
    records.value = res.list;
    recordsTotal.value = res.total;
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '备份记录加载失败');
  } finally {
    recordsLoading.value = false;
  }
}

function onRecordsPageChange(p: number) {
  recordsPage.value = p;
  void loadRecords();
}

async function onRestore(row: BackupRecordRow) {
  try {
    await ElMessageBox.confirm(
      `恢复 ${SCOPE_LABEL[row.scope] ?? row.scope} 备份（${new Date(row.createdAt).toLocaleString('zh-CN', { hour12: false })}）？恢复为高风险操作，将覆盖当前数据，确认继续？`,
      '恢复备份',
      { type: 'warning', confirmButtonText: '确认恢复', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    await restoreBackup(row.id);
    ElMessage.success('恢复任务已登记（演示环境不执行真实恢复，操作已记入审计）');
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '恢复失败');
  }
}

function fmtSize(bytes: number | null): string {
  if (bytes == null) return '—';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function fmtTime(v: string) {
  return new Date(v).toLocaleString('zh-CN', { hour12: false });
}

onMounted(() => {
  void loadPolicy();
  void loadRecords();
});
</script>

<template>
  <div class="backup-page">
    <PageHead title="备份恢复" desc="保障业务数据安全（PRD A-15）" :tags="['自动备份', '恢复', '备份记录']" />

    <div class="grid-2 mb16">
      <div class="panel">
        <div class="panel-head"><h2>自动备份策略</h2><span class="sub">默认每日执行 · 保留最近 30 份</span></div>
        <div class="panel-body">
          <div class="form-grid mb12">
            <div class="field">
              <label>备份范围</label>
              <el-select v-model="policy.scope">
                <el-option v-for="o in SCOPE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
              </el-select>
            </div>
            <div class="field">
              <label>执行周期</label>
              <el-select v-model="policy.schedule">
                <el-option v-for="o in SCHEDULE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
              </el-select>
            </div>
            <div class="field">
              <label>保留份数</label>
              <el-input-number v-model="policy.keep" :min="1" :max="365" :step="1" step-strictly style="width: 100%" />
            </div>
          </div>
          <div class="flex">
            <el-button type="primary" :loading="policySaving" @click="onSavePolicy">保存策略</el-button>
            <el-button :loading="backingUp" @click="onBackupNow">立即备份</el-button>
          </div>
          <div class="small muted mt12">演示环境：仅记录备份任务，不执行真实备份操作。</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>备份记录</h2><span class="sub">时间 · 范围 · 大小 · 状态</span></div>
        <div class="panel-body">
          <el-table v-loading="recordsLoading" :data="records" style="width: 100%">
            <el-table-column label="备份时间" width="170">
              <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
            </el-table-column>
            <el-table-column label="范围" width="100">
              <template #default="{ row }">{{ SCOPE_LABEL[row.scope] ?? row.scope }}</template>
            </el-table-column>
            <el-table-column label="大小" width="90" align="right">
              <template #default="{ row }"><span class="num">{{ fmtSize(row.sizeBytes) }}</span></template>
            </el-table-column>
            <el-table-column label="状态" min-width="150">
              <template #default="{ row }">
                <el-tag :type="row.status === 'SUCCESS' ? 'success' : 'danger'" effect="light" size="small">
                  {{ row.status === 'SUCCESS' ? '成功' : `失败${row.message ? ` · ${row.message}` : ''}` }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80" fixed="right">
              <template #default="{ row }">
                <el-button v-if="row.status === 'SUCCESS'" link type="primary" @click="onRestore(row)">恢复</el-button>
              </template>
            </el-table-column>
            <template #empty><div class="empty-state">暂无备份记录，点击「立即备份」创建</div></template>
          </el-table>
          <div class="pager">
            <el-pagination background layout="total, prev, pager, next" :total="recordsTotal" :page-size="20" :current-page="recordsPage" @current-change="onRecordsPageChange" />
          </div>
          <div class="small muted mt12">恢复操作高风险，需管理员二次确认并记录审计日志；恢复失败不影响当前生产数据。演示环境不执行真实恢复。</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.grid-2 { display: grid; grid-template-columns: 5fr 7fr; gap: 16px; }
.mb16 { margin-bottom: 16px; }
.panel { background: #fff; border: 1px solid #eef2f7; border-radius: 14px; overflow: hidden; }
.panel-head { display: flex; align-items: baseline; gap: 10px; padding: 14px 20px 0; }
.panel-head h2 { font-size: 15px; font-weight: 600; color: #1e293b; margin: 0; }
.panel-head .sub { font-size: 12px; color: #94a3b8; }
.panel-body { padding: 14px 20px 20px; }
.form-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.field label { display: block; font-size: 12px; color: #64748b; margin-bottom: 6px; }
.flex { display: flex; gap: 10px; }
.small { font-size: 12px; }
.muted { color: #94a3b8; }
.mt12 { margin-top: 12px; }
.num { font-weight: 600; color: #1e293b; }
.pager { display: flex; justify-content: flex-end; margin-top: 12px; }
.empty-state { padding: 32px 0; color: #94a3b8; font-size: 13px; }
@media (max-width: 1200px) {
  .grid-2 { grid-template-columns: 1fr; }
}
</style>
