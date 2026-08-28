<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHead from '@/components/PageHead.vue';
import { ApiError } from '@/api/http';
import { fetchDatasets, updateDataset, setDatasetStatus } from '@/api/admin';
import type { AdminDatasetRow } from '@/api/admin';

const SOURCE_LABEL: Record<string, string> = {
  IMPORT: '数据接入审核',
  UPLOAD: '用户上传',
  COLLECT: '系统采集',
};
const SOURCE_TAG: Record<string, 'primary' | 'success' | 'warning'> = {
  IMPORT: 'primary',
  UPLOAD: 'success',
  COLLECT: 'warning',
};

const loading = ref(false);
const list = ref<AdminDatasetRow[]>([]);
const total = ref(0);
const query = reactive({ keyword: '', source: '', status: '', page: 1, pageSize: 20 });

async function load() {
  loading.value = true;
  try {
    const res = await fetchDatasets(query);
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

function metaSummary(row: AdminDatasetRow): string {
  const m = row.meta as Record<string, unknown> | null;
  if (!m) return '—';
  const parts: string[] = [];
  if (typeof m.timeRange === 'string' && m.timeRange) parts.push(m.timeRange);
  if (typeof m.countries === 'string' && m.countries) parts.push(m.countries);
  return parts.length ? parts.join(' · ') : '—';
}

// ===== 查看 / 编辑 =====
const viewVisible = ref(false);
const viewRow = ref<AdminDatasetRow | null>(null);

function openView(row: AdminDatasetRow) {
  viewRow.value = row;
  viewVisible.value = true;
}

const dialogVisible = ref(false);
const editId = ref('');
const saving = ref(false);
const form = reactive({ name: '', category: '', timeRange: '', countries: '' });

function openEdit(row: AdminDatasetRow) {
  editId.value = row.id;
  const m = row.meta as Record<string, unknown> | null;
  Object.assign(form, {
    name: row.name,
    category: row.category ?? '',
    timeRange: (m?.timeRange as string) ?? '',
    countries: (m?.countries as string) ?? '',
  });
  dialogVisible.value = true;
}

async function onSave() {
  if (!form.name) {
    ElMessage.warning('请填写数据集名称');
    return;
  }
  saving.value = true;
  try {
    const meta: Record<string, unknown> = {};
    if (form.timeRange) meta.timeRange = form.timeRange;
    if (form.countries) meta.countries = form.countries;
    await updateDataset(editId.value, { name: form.name, category: form.category || undefined, meta: Object.keys(meta).length ? meta : null });
    ElMessage.success('数据集已更新');
    dialogVisible.value = false;
    void load();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

async function onToggle(row: AdminDatasetRow) {
  const target = row.status === 'ONLINE' ? 'OFFLINE' : 'ONLINE';
  const isOffline = target === 'OFFLINE';
  try {
    await ElMessageBox.confirm(
      `确认${isOffline ? '下架' : '上架'}数据集「${row.name}」？${isOffline ? '下架后不参与检索，已生成结果/报告不受影响。' : ''}`,
      isOffline ? '下架数据集' : '上架数据集',
      { type: 'warning', confirmButtonText: isOffline ? '下架' : '上架', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    await setDatasetStatus(row.id, target);
    ElMessage.success(isOffline ? '已下架' : '已上架');
    void load();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '操作失败');
  }
}

onMounted(() => void load());
</script>

<template>
  <div class="datasets-page">
    <PageHead title="数据资产管理" desc="管理平台公共和组织数据集（PRD A-07）" :tags="['查看', '编辑', '上下架']" />

    <div class="panel filter-panel">
      <div class="toolbar">
        <el-input v-model="query.keyword" class="search-input" placeholder="按名称 / 分类搜索" clearable @keyup.enter="onSearch" @clear="onSearch">
          <template #prefix>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="1.8" /><path d="m16 16 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
          </template>
        </el-input>
        <el-select v-model="query.source" placeholder="全部来源" clearable class="filter-select" @change="onSearch">
          <el-option label="数据接入审核" value="IMPORT" />
          <el-option label="用户上传" value="UPLOAD" />
          <el-option label="系统采集" value="COLLECT" />
        </el-select>
        <el-select v-model="query.status" placeholder="全部状态" clearable class="filter-select" @change="onSearch">
          <el-option label="已上架" value="ONLINE" />
          <el-option label="已下架" value="OFFLINE" />
        </el-select>
        <span class="spacer"></span>
        <el-button @click="load">刷新</el-button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>数据集列表</h2><span class="sub">下架后不参与检索，已生成结果/报告不受影响</span></div>
      <div class="panel-body">
        <el-table v-loading="loading" :data="list" style="width: 100%">
          <el-table-column label="数据集名称" min-width="220">
            <template #default="{ row }">
              <div>
                <span class="cell-strong">{{ row.name }}</span>
                <div class="muted small">{{ row.tenantId ? '组织数据集' : '平台公共' }}{{ metaSummary(row) !== '—' ? ' · ' + metaSummary(row) : '' }}</div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="来源" width="130">
            <template #default="{ row }">
              <el-tag :type="SOURCE_TAG[row.source] ?? 'info'" effect="light" size="small">{{ SOURCE_LABEL[row.source] ?? row.source }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="分类" width="120">
            <template #default="{ row }">{{ row.category ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="字段数" width="90" align="center">
            <template #default="{ row }"><span class="num">{{ row.fieldCount }}</span></template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <span class="status-dot" :class="row.status === 'ONLINE' ? 'on' : 'off'"></span>
              {{ row.status === 'ONLINE' ? '已上架' : '已下架' }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openView(row)">查看</el-button>
              <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button link :type="row.status === 'ONLINE' ? 'danger' : 'success'" @click="onToggle(row)">
                {{ row.status === 'ONLINE' ? '下架' : '上架' }}
              </el-button>
            </template>
          </el-table-column>
          <template #empty><div class="empty-state">暂无数据集</div></template>
        </el-table>

        <div class="pager">
          <el-pagination background layout="total, prev, pager, next" :total="total" :page-size="query.pageSize" :current-page="query.page" @current-change="onPageChange" />
        </div>

        <div class="alert-warning">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 3 22 20H2L12 3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /><path d="M12 10v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /><circle cx="12" cy="17" r="0.6" fill="currentColor" /></svg>
          下架被报告引用的数据集时提示影响范围并二次确认。
        </div>
      </div>
    </div>

    <!-- 查看详情 -->
    <el-dialog v-model="viewVisible" title="数据集详情" width="480px">
      <template v-if="viewRow">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="名称">{{ viewRow.name }}</el-descriptions-item>
          <el-descriptions-item label="归属">{{ viewRow.tenantId ? '组织数据集' : '平台公共数据集' }}</el-descriptions-item>
          <el-descriptions-item label="来源">{{ SOURCE_LABEL[viewRow.source] ?? viewRow.source }}</el-descriptions-item>
          <el-descriptions-item label="分类">{{ viewRow.category ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="字段数">{{ viewRow.fieldCount }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ viewRow.status === 'ONLINE' ? '已上架' : '已下架' }}</el-descriptions-item>
          <el-descriptions-item label="时间范围">{{ (viewRow.meta as any)?.timeRange ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="覆盖国家">{{ (viewRow.meta as any)?.countries ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ new Date(viewRow.createdAt).toLocaleString() }}</el-descriptions-item>
        </el-descriptions>
      </template>
      <template #footer>
        <el-button @click="viewVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 编辑元数据 -->
    <el-dialog v-model="dialogVisible" title="编辑数据集元数据" width="480px" :close-on-click-modal="false">
      <el-form label-width="90px" label-position="left">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" maxlength="255" />
        </el-form-item>
        <el-form-item label="分类">
          <el-input v-model="form.category" maxlength="64" placeholder="如 宏观经济（可空）" />
        </el-form-item>
        <el-form-item label="时间范围">
          <el-input v-model="form.timeRange" maxlength="64" placeholder="如 2020-2025" />
        </el-form-item>
        <el-form-item label="覆盖国家">
          <el-input v-model="form.countries" maxlength="128" placeholder="如 中国/美国" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
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
.search-input { width: 240px; }
.filter-select { width: 150px; }
.spacer { flex: 1; }
.cell-strong { font-weight: 600; color: #1e293b; }
.muted { color: #94a3b8; }
.small { font-size: 12px; margin-top: 2px; }
.num { font-weight: 600; color: #1e293b; }
.status-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; vertical-align: 1px; }
.status-dot.on { background: #67c23a; }
.status-dot.off { background: #f56c6c; }
.pager { display: flex; justify-content: flex-end; margin-top: 16px; }
.alert-warning { display: flex; align-items: center; gap: 6px; margin-top: 14px; padding: 10px 14px; border-radius: 8px; background: #fdf6ec; color: #b88230; font-size: 12px; }
.alert-warning svg { color: #e6a23c; flex-shrink: 0; }
.empty-state { padding: 32px 0; color: #94a3b8; font-size: 13px; }
</style>
