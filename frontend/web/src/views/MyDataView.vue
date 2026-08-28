<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import TopNav from '@/components/TopNav.vue';
import {
  listMyDatasets,
  archiveDataset,
  deleteDataset,
  exportDatasetsCsv,
  type MyDatasetItem,
} from '@/api/workspace';

/** 筛选条件 */
const keyword = ref('');
const tagFilter = ref('');
const statusFilter = ref('');
const page = ref(1);
const pageSize = 10;

const loading = ref(false);
const items = ref<MyDatasetItem[]>([]);
const total = ref(0);

/** 标签下拉选项：从当前列表聚合（全量标签在数据量小时由列表近似覆盖） */
const tagOptions = computed(() => {
  const set = new Set<string>();
  items.value.forEach((d) => d.tags.forEach((t) => set.add(t)));
  return [...set].sort();
});

/** 状态徽标文案 */
function statusText(s: string): string {
  return s === 'ARCHIVED' ? '已归档' : '已上架';
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const out = await listMyDatasets({
      keyword: keyword.value,
      tag: tagFilter.value,
      status: statusFilter.value,
      page: page.value,
      pageSize,
    });
    items.value = out.list;
    total.value = out.total;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '列表加载失败');
  } finally {
    loading.value = false;
  }
}

function search(): void {
  page.value = 1;
  void load();
}

/** 归档/恢复（幂等 toggle） */
async function onArchive(item: MyDatasetItem): Promise<void> {
  try {
    const out = await archiveDataset(item.id);
    ElMessage.success(out.status === 'ARCHIVED' ? '已归档' : '已恢复');
    void load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败');
  }
}

/** 删除（硬删，先确认） */
async function onDelete(item: MyDatasetItem): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除「${item.name}」？删除后不可恢复。`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await deleteDataset(item.id);
    ElMessage.success('已删除');
    void load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败');
  }
}

/** 导出清单（CSV） */
async function onExport(): Promise<void> {
  try {
    await exportDatasetsCsv();
    ElMessage.success('已导出清单 CSV');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '导出失败');
  }
}

// ===== 溯源弹窗（数据快照详情） =====

const traceVisible = ref(false);
const traceItem = ref<MyDatasetItem | null>(null);
const traceYears = computed(() => traceItem.value?.data?.years ?? []);
const traceSeries = computed(() => traceItem.value?.data?.series ?? []);

function onTrace(item: MyDatasetItem): void {
  traceItem.value = item;
  traceVisible.value = true;
}

function fmtVal(v: number | undefined): string {
  return v == null ? '..' : String(v);
}

function sourceTypeText(s: string): string {
  if (s === 'WDI') return '世界银行 WDI';
  if (s === 'upload') return '本地上传';
  return 'WDI + 本地上传';
}

onMounted(load);
</script>

<template>
  <div class="md-page">
    <TopNav />

    <div class="md-container">
      <!-- 页头 -->
      <div class="md-head">
        <div>
          <h1>我的数据</h1>
          <p>管理个人与组织数据资产，支持标签、归档、删除（PRD U-14）</p>
        </div>
        <button class="btn" @click="onExport">
          <svg class="ic" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
          导出清单
        </button>
      </div>

      <!-- 筛选工具栏 -->
      <div class="md-toolbar">
        <el-input
          v-model="keyword"
          placeholder="按关键词搜索数据资产"
          clearable
          style="width: 240px"
          @keyup.enter="search"
          @clear="search"
        >
          <template #prefix>
            <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8" /><path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
          </template>
        </el-input>
        <el-select v-model="tagFilter" placeholder="全部标签" clearable style="width: 150px" @change="search">
          <el-option v-for="t in tagOptions" :key="t" :label="t" :value="t" />
        </el-select>
        <el-select v-model="statusFilter" placeholder="全部状态" clearable style="width: 140px" @change="search">
          <el-option label="已上架" value="ACTIVE" />
          <el-option label="已归档" value="ARCHIVED" />
        </el-select>
        <span class="spacer" />
        <el-button @click="load">刷新</el-button>
      </div>

      <!-- 数据表 -->
      <div class="md-panel" v-loading="loading">
        <table class="md-table">
          <thead>
            <tr>
              <th style="width: 34px"><input type="checkbox" disabled /></th>
              <th>数据名称</th>
              <th>标签</th>
              <th>状态</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in items" :key="d.id" :class="{ archived: d.status === 'ARCHIVED' }">
              <td><input type="checkbox" disabled /></td>
              <td>
                <div class="d-name">{{ d.name }}</div>
                <div class="d-sub">{{ sourceTypeText(d.sourceType) }} · {{ d.data?.series?.length ?? 0 }} 个国家/地区</div>
              </td>
              <td>
                <span v-for="t in d.tags" :key="t" class="tag">{{ t }}</span>
                <span v-if="!d.tags.length" class="muted">—</span>
              </td>
              <td>
                <span class="st" :class="d.status === 'ARCHIVED' ? 'st-arch' : 'st-active'">{{ statusText(d.status) }}</span>
              </td>
              <td class="t-cell">{{ new Date(d.updatedAt).toLocaleString() }}</td>
              <td class="ops">
                <a @click="onTrace(d)">溯源</a>
                <a @click="onArchive(d)">{{ d.status === 'ARCHIVED' ? '恢复' : '归档' }}</a>
                <a class="danger" @click="onDelete(d)">删除</a>
              </td>
            </tr>
            <tr v-if="!items.length && !loading">
              <td colspan="6" class="empty">暂无数据 · 可在工作台「收藏到我的数据」</td>
            </tr>
          </tbody>
        </table>
        <div class="pager">
          <span>共 {{ total }} 条</span>
          <el-pagination
            v-model:current-page="page"
            :page-size="pageSize"
            :total="total"
            layout="prev, pager, next"
            @current-change="load"
          />
        </div>
      </div>
    </div>

    <!-- 溯源弹窗：数据快照详情 -->
    <el-dialog v-model="traceVisible" :title="`数据溯源 · ${traceItem?.name ?? ''}`" width="720px">
      <div v-if="traceItem" class="trace">
        <div class="trace-meta">
          <div><span class="k">数据名称</span>{{ traceItem.name }}</div>
          <div><span class="k">来源</span>{{ sourceTypeText(traceItem.sourceType) }}</div>
          <div><span class="k">标签</span>{{ traceItem.tags.join('、') || '—' }}</div>
          <div><span class="k">收藏时间</span>{{ new Date(traceItem.createdAt).toLocaleString() }}</div>
        </div>
        <div v-if="traceSeries.length" class="trace-tbl-wrap">
          <table class="trace-tbl">
            <thead>
              <tr>
                <th>国家/地区</th>
                <th v-for="y in traceYears" :key="y">{{ y }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in traceSeries" :key="s.country">
                <td>{{ s.country }}</td>
                <td v-for="y in traceYears" :key="y">{{ fmtVal(s.values[y]) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="trace-empty">该快照不含时序明细数据。</div>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.md-page {
  min-height: 100vh;
  background: #f7f9fc;
}
.md-container {
  max-width: 1080px;
  margin: 0 auto;
  padding: 28px 24px 48px;
}
.md-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}
.md-head h1 {
  font-size: 24px;
  font-weight: 800;
  color: #0f172a;
  margin: 0;
}
.md-head p {
  margin: 6px 0 0;
  font-size: 13px;
  color: #64748b;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border: 1px solid #dbe2ee;
  border-radius: 9px;
  background: #fff;
  color: #334155;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.btn:hover {
  color: #2563eb;
  border-color: #2563eb;
  background: #eff4ff;
}
.ic {
  width: 15px;
  height: 15px;
}
.md-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 14px 16px;
  border: 1px solid #e6edf8;
  border-radius: 12px;
  background: #fff;
  margin-bottom: 16px;
}
.spacer {
  flex: 1;
}
.md-panel {
  border: 1px solid #e6edf8;
  border-radius: 12px;
  background: #fff;
  padding: 4px 0 12px;
  min-height: 220px;
}
.md-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.md-table th {
  text-align: left;
  padding: 11px 14px;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
  border-bottom: 1px solid #eef2f7;
  background: #fbfcfe;
}
.md-table td {
  padding: 12px 14px;
  border-bottom: 1px solid #f1f5f9;
  color: #334155;
  vertical-align: top;
}
.md-table tr.archived td {
  color: #94a3b8;
}
.d-name {
  font-weight: 600;
  color: #0f172a;
  max-width: 360px;
}
.archived .d-name {
  color: #94a3b8;
}
.d-sub {
  margin-top: 3px;
  font-size: 11.5px;
  color: #94a3b8;
}
.tag {
  display: inline-block;
  margin: 0 4px 4px 0;
  padding: 2px 8px;
  background: #eff4ff;
  color: #2563eb;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
}
.muted {
  color: #94a3b8;
}
.st {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 700;
}
.st-active {
  background: #ecfdf5;
  color: #059669;
}
.st-arch {
  background: #f1f5f9;
  color: #64748b;
}
.t-cell {
  white-space: nowrap;
  color: #64748b;
  font-size: 12.5px;
}
.ops a {
  color: #2563eb;
  cursor: pointer;
  margin-right: 10px;
  white-space: nowrap;
}
.ops a:hover {
  text-decoration: underline;
}
.ops a.danger {
  color: #dc2626;
}
.empty {
  text-align: center;
  padding: 44px 0;
  color: #94a3b8;
  font-size: 13px;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px 2px;
  font-size: 12.5px;
  color: #64748b;
}
.trace-meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 20px;
  font-size: 13px;
  color: #334155;
  padding: 12px 14px;
  background: #f8fafc;
  border-radius: 8px;
  margin-bottom: 14px;
}
.trace-meta .k {
  color: #94a3b8;
  margin-right: 8px;
}
.trace-tbl-wrap {
  overflow: auto;
  max-height: 320px;
  border: 1px solid #eef2f7;
  border-radius: 8px;
}
.trace-tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.trace-tbl th,
.trace-tbl td {
  padding: 7px 10px;
  border-bottom: 1px solid #eef2f7;
  white-space: nowrap;
  text-align: right;
}
.trace-tbl th {
  background: #f1f5f9;
  color: #475569;
  font-weight: 700;
  position: sticky;
  top: 0;
}
.trace-tbl td:first-child,
.trace-tbl th:first-child {
  text-align: left;
  font-weight: 600;
  color: #0f172a;
}
.trace-empty {
  text-align: center;
  padding: 28px 0;
  color: #94a3b8;
  font-size: 13px;
}
</style>
