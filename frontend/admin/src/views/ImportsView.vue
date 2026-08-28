<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHead from '@/components/PageHead.vue';
import { ApiError } from '@/api/http';
import { fetchImports, approveImport, rejectImport, fetchImportPreview } from '@/api/admin';
import type { AdminImportRow } from '@/api/admin';

const TYPE_LABEL: Record<string, string> = {
  EXCEL: 'Excel',
  CSV: 'CSV',
  DATABASE: '数据库',
  API: 'API',
};

const loading = ref(false);
const list = ref<AdminImportRow[]>([]);
const total = ref(0);
const query = reactive({ status: 'PENDING', type: '', page: 1, pageSize: 20 });

async function load() {
  loading.value = true;
  try {
    const res = await fetchImports(query);
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

function fmtSize(bytes: number | null): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtTime(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function rowClass({ row }: { row: AdminImportRow }): string {
  return row.overdue ? 'row-overdue' : '';
}

// ===== 数据预览 =====
const previewVisible = ref(false);
const previewLoading = ref(false);
const previewRow = ref<AdminImportRow | null>(null);
const previewData = ref<{ headers?: string[]; rows?: unknown[][] } | null>(null);

async function openPreview(row: AdminImportRow) {
  previewRow.value = row;
  previewVisible.value = true;
  previewLoading.value = true;
  previewData.value = null;
  try {
    const res = await fetchImportPreview(row.id);
    previewData.value = res.preview;
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '预览加载失败');
  } finally {
    previewLoading.value = false;
  }
}

// ===== 通过 / 退回 =====
async function onApprove(row: AdminImportRow) {
  try {
    await ElMessageBox.confirm(`确认通过「${row.name}」？通过后将入库为公共数据集。`, '审核通过', {
      type: 'warning',
      confirmButtonText: '通过',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await approveImport(row.id);
    ElMessage.success('已通过并入库，已通知提交人');
    previewVisible.value = false;
    void load();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '操作失败');
  }
}

const rejectVisible = ref(false);
const rejectRow = ref<AdminImportRow | null>(null);
const rejectReason = ref('');
const rejecting = ref(false);

function openReject(row: AdminImportRow) {
  rejectRow.value = row;
  rejectReason.value = '';
  rejectVisible.value = true;
}

async function onReject() {
  if (!rejectReason.value.trim()) {
    ElMessage.warning('退回原因必填');
    return;
  }
  if (!rejectRow.value) return;
  rejecting.value = true;
  try {
    await rejectImport(rejectRow.value.id, rejectReason.value.trim());
    ElMessage.success('已退回，已通知提交人');
    rejectVisible.value = false;
    previewVisible.value = false;
    void load();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '操作失败');
  } finally {
    rejecting.value = false;
  }
}

onMounted(() => void load());
</script>

<template>
  <div class="imports-page">
    <PageHead title="数据接入审核" desc="审核用户上传或系统采集的数据（PRD A-08）" :tags="['审核队列', '通过', '退回']" />

    <div class="panel filter-panel">
      <div class="toolbar">
        <el-select v-model="query.status" class="filter-select" @change="onSearch">
          <el-option label="待审核" value="PENDING" />
          <el-option label="已通过" value="APPROVED" />
          <el-option label="已退回" value="REJECTED" />
          <el-option label="全部状态" value="" />
        </el-select>
        <el-select v-model="query.type" placeholder="全部类型" clearable class="filter-select" @change="onSearch">
          <el-option label="Excel" value="EXCEL" />
          <el-option label="CSV" value="CSV" />
          <el-option label="数据库" value="DATABASE" />
          <el-option label="API" value="API" />
        </el-select>
        <span class="spacer"></span>
        <el-button @click="load">刷新</el-button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>审核队列</h2><span class="sub">待审核导入任务</span></div>
      <div class="panel-body">
        <el-table v-loading="loading" :data="list" :row-class-name="rowClass" style="width: 100%">
          <el-table-column label="数据名称" min-width="200">
            <template #default="{ row }">
              <span class="cell-strong">{{ row.name }}</span>
              <div class="muted small">大小 {{ fmtSize(row.sizeBytes) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="来源/类型" width="100">
            <template #default="{ row }">
              <el-tag effect="plain" size="small">{{ TYPE_LABEL[row.type] ?? row.type }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="提交人" width="120">
            <template #default="{ row }">{{ row.submitter ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="提交时间" width="150">
            <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag v-if="row.status === 'PENDING'" type="warning" effect="light" size="small">待审核</el-tag>
              <el-tag v-else-if="row.status === 'APPROVED'" type="success" effect="light" size="small">已通过</el-tag>
              <el-tag v-else type="danger" effect="light" size="small">已退回</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openPreview(row)">预览</el-button>
              <template v-if="row.status === 'PENDING'">
                <el-button link type="success" @click="onApprove(row)">通过</el-button>
                <el-button link type="danger" @click="openReject(row)">退回</el-button>
              </template>
            </template>
          </el-table-column>
          <template #empty><div class="empty-state">暂无审核任务</div></template>
        </el-table>

        <div class="pager">
          <el-pagination background layout="total, prev, pager, next" :total="total" :page-size="query.pageSize" :current-page="query.page" @current-change="onPageChange" />
        </div>

        <div class="alert-warning">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.6" /><path d="M12 7.5v5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
          超过 3 个工作日未处理的审核任务将突出展示提醒（黄色高亮行）。
        </div>
      </div>
    </div>

    <!-- 数据预览 -->
    <el-dialog v-model="previewVisible" :title="`数据预览 · ${previewRow?.name ?? ''}`" width="640px">
      <div v-loading="previewLoading">
        <p class="preview-sub">前 5 行 · 表头+数据</p>
        <el-table v-if="previewData && previewData.headers" :data="previewData.rows ?? []" border size="small" style="width: 100%">
          <el-table-column v-for="(h, i) in previewData.headers" :key="i" :label="String(h)" min-width="110">
            <template #default="{ row }">{{ row[i] ?? '' }}</template>
          </el-table-column>
        </el-table>
        <el-empty v-else-if="!previewLoading" description="暂无预览数据" :image-size="60" />
      </div>
      <template #footer>
        <el-button @click="previewVisible = false">关闭</el-button>
        <template v-if="previewRow?.status === 'PENDING'">
          <el-button type="danger" plain @click="openReject(previewRow)">退回</el-button>
          <el-button type="success" @click="onApprove(previewRow)">通过</el-button>
        </template>
      </template>
    </el-dialog>

    <!-- 退回弹窗 -->
    <el-dialog v-model="rejectVisible" :title="`退回 · ${rejectRow?.name ?? ''}`" width="460px" :close-on-click-modal="false">
      <el-form label-width="80px" label-position="left">
        <el-form-item label="退回原因" required>
          <el-input v-model="rejectReason" type="textarea" :rows="3" maxlength="512" show-word-limit placeholder="必填，将通知提交人" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rejectVisible = false">取消</el-button>
        <el-button type="danger" :loading="rejecting" @click="onReject">确认退回</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.panel { background: #fff; border: 1px solid #eef2f7; border-radius: 14px; overflow: hidden; margin-bottom: 16px; }
.panel-head { display: flex; align-items: baseline; justify-content: space-between; padding: 16px 20px 0; }
.panel-head h2 { margin: 0; font-size: 15px; font-weight: 600; color: #0f172a; }
.panel-head .sub { font-size: 12px; color: #94a3b8; }
.panel-body { padding: 16px 20px 20px; }
.filter-panel .toolbar { display: flex; align-items: center; gap: 10px; padding: 16px 20px; }
.filter-select { width: 150px; }
.spacer { flex: 1; }
.cell-strong { font-weight: 600; color: #1e293b; }
.muted { color: #94a3b8; }
.small { font-size: 12px; margin-top: 2px; }
.pager { display: flex; justify-content: flex-end; margin-top: 16px; }
.alert-warning { display: flex; align-items: center; gap: 6px; margin-top: 14px; padding: 10px 14px; border-radius: 8px; background: #fdf6ec; color: #b88230; font-size: 12px; }
.alert-warning svg { color: #e6a23c; flex-shrink: 0; }
.empty-state { padding: 32px 0; color: #94a3b8; font-size: 13px; }
.preview-sub { margin: 0 0 12px; font-size: 13px; color: #64748b; }
:deep(.el-table .row-overdue td) { background: #fef6e8; }
</style>
