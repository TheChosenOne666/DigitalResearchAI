<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import TopNav from '@/components/TopNav.vue';
import {
  listMyReports,
  fetchReportVersions,
  exportReport,
  type MyReportItem,
  type ReportVersionItem,
} from '@/api/workspace';

const router = useRouter();

const loading = ref(false);
const items = ref<MyReportItem[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 10;
const keyword = ref('');

async function load(): Promise<void> {
  loading.value = true;
  try {
    const out = await listMyReports({ keyword: keyword.value, page: page.value, pageSize });
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

/** 状态徽标 */
function statusText(s: string): string {
  if (s === 'READY') return '已生成';
  if (s === 'ARCHIVED') return '已归档';
  return '草稿';
}

/** 浏览：search → 智搜报告详情页；workspace → 分析结果页 */
function onView(item: MyReportItem): void {
  if (item.type === 'search') {
    router.push(`/search/reports/${encodeURIComponent(item.id)}`);
  } else {
    router.push(`/workspace/analyze/${encodeURIComponent(item.id)}`);
  }
}

/** 下载（导出 Word/PPT，D1 两类报告都支持） */
const exporting = ref(false);

async function onDownload(item: MyReportItem, format: 'docx' | 'pptx'): Promise<void> {
  if (exporting.value) return;
  exporting.value = true;
  try {
    await exportReport(item.type, item.id, format);
    ElMessage.success(`已导出 ${format === 'docx' ? 'Word' : 'PPT'} 文件`);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '导出失败');
  } finally {
    exporting.value = false;
  }
}

/** 版本列表弹窗 */
const verVisible = ref(false);
const verLoading = ref(false);
const verItem = ref<MyReportItem | null>(null);
const versions = ref<ReportVersionItem[]>([]);

async function onVersions(item: MyReportItem): Promise<void> {
  verItem.value = item;
  versions.value = [];
  verVisible.value = true;
  verLoading.value = true;
  try {
    const out = await fetchReportVersions(item.id, item.type);
    versions.value = out.list;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '版本加载失败');
  } finally {
    verLoading.value = false;
  }
}

/** 编辑/分享占位（D3：本期不做） */
function comingSoon(name: string): void {
  ElMessage.info(`「${name}」将在后续批次开放`);
}

onMounted(load);
</script>

<template>
  <div class="mr-page">
    <TopNav />

    <div class="mr-container">
      <!-- 页头 -->
      <div class="mr-head">
        <div>
          <h1>我的报告</h1>
          <p>浏览、编辑、下载、分享与版本管理（PRD U-15）</p>
        </div>
        <button class="btn primary" @click="router.push('/')">
          <svg class="ic" viewBox="0 0 24 24" fill="none"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /></svg>
          新建智搜报告
        </button>
      </div>

      <!-- 搜索 -->
      <div class="mr-toolbar">
        <el-input
          v-model="keyword"
          placeholder="按报告名称 / 问题关键词搜索"
          clearable
          style="width: 280px"
          @keyup.enter="search"
          @clear="search"
        >
          <template #prefix>
            <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8" /><path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
          </template>
        </el-input>
        <span class="spacer" />
        <el-button @click="load">刷新</el-button>
      </div>

      <!-- 报告表 -->
      <div class="mr-panel" v-loading="loading">
        <table class="mr-table">
          <thead>
            <tr>
              <th>报告名称</th>
              <th style="width: 100px">格式</th>
              <th style="width: 70px">版本</th>
              <th style="width: 170px">更新时间</th>
              <th style="width: 90px">状态</th>
              <th style="width: 260px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in items" :key="r.type + r.id">
              <td>
                <div class="r-name" @click="onView(r)">{{ r.name }}</div>
              </td>
              <td>
                <span class="fmt" :class="r.type">{{ r.format }}</span>
              </td>
              <td class="num">v{{ r.version }}</td>
              <td class="t-cell">{{ new Date(r.updatedAt).toLocaleString() }}</td>
              <td>
                <span class="st" :class="r.status === 'READY' ? 'st-ready' : 'st-draft'">{{ statusText(r.status) }}</span>
              </td>
              <td class="ops">
                <a @click="onView(r)">浏览</a>
                <el-dropdown trigger="click" @command="(f: 'docx' | 'pptx') => onDownload(r, f)">
                  <a>下载</a>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="docx">导出 Word（.docx）</el-dropdown-item>
                      <el-dropdown-item command="pptx">导出 PPT（.pptx）</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
                <a @click="onVersions(r)">版本</a>
                <a @click="comingSoon('编辑报告')">编辑</a>
                <a @click="comingSoon('分享报告')">分享</a>
              </td>
            </tr>
            <tr v-if="!items.length && !loading">
              <td colspan="6" class="empty">暂无报告 · 智搜与分析结果报告将自动汇总到这里</td>
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

    <!-- 版本列表弹窗 -->
    <el-dialog v-model="verVisible" :title="`版本管理 · ${verItem?.name ?? ''}`" width="560px">
      <div v-loading="verLoading" class="ver-body">
        <table class="ver-table">
          <thead>
            <tr>
              <th style="width: 70px">版本号</th>
              <th>生成时间</th>
              <th style="width: 110px">Token 消耗</th>
              <th style="width: 90px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="v in versions" :key="v.id">
              <td class="num">v{{ v.version }}</td>
              <td class="t-cell">{{ new Date(v.createdAt).toLocaleString() }}</td>
              <td class="num">{{ v.tokenUsage ?? '—' }}</td>
              <td class="ops">
                <a v-if="verItem" @click="onDownload(verItem, 'docx')">下载</a>
              </td>
            </tr>
            <tr v-if="!versions.length && !verLoading">
              <td colspan="4" class="empty">暂无版本记录</td>
            </tr>
          </tbody>
        </table>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.mr-page {
  min-height: 100vh;
  background: #f7f9fc;
}
.mr-container {
  max-width: 1080px;
  margin: 0 auto;
  padding: 28px 24px 48px;
}
.mr-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}
.mr-head h1 {
  font-size: 24px;
  font-weight: 800;
  color: #0f172a;
  margin: 0;
}
.mr-head p {
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
.btn.primary {
  color: #fff;
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  border-color: transparent;
}
.btn.primary:hover {
  filter: brightness(1.06);
}
.ic {
  width: 15px;
  height: 15px;
}
.mr-toolbar {
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
.mr-panel {
  border: 1px solid #e6edf8;
  border-radius: 12px;
  background: #fff;
  padding: 4px 0 12px;
  min-height: 220px;
}
.mr-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.mr-table th {
  text-align: left;
  padding: 11px 14px;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
  border-bottom: 1px solid #eef2f7;
  background: #fbfcfe;
}
.mr-table td {
  padding: 12px 14px;
  border-bottom: 1px solid #f1f5f9;
  color: #334155;
  vertical-align: middle;
}
.r-name {
  font-weight: 600;
  color: #0f172a;
  max-width: 380px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.r-name:hover {
  color: #2563eb;
}
.fmt {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 700;
}
.fmt.search {
  background: #eff4ff;
  color: #2563eb;
}
.fmt.workspace {
  background: #ecfdf5;
  color: #059669;
}
.num {
  font-variant-numeric: tabular-nums;
  color: #475569;
}
.t-cell {
  white-space: nowrap;
  color: #64748b;
  font-size: 12.5px;
}
.st {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 700;
}
.st-ready {
  background: #ecfdf5;
  color: #059669;
}
.st-draft {
  background: #fffbeb;
  color: #b45309;
}
.ops {
  white-space: nowrap;
}
.ops a {
  color: #2563eb;
  cursor: pointer;
  margin-right: 10px;
}
.ops a:hover {
  text-decoration: underline;
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
.ver-body {
  min-height: 80px;
}
.ver-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.ver-table th {
  text-align: left;
  padding: 10px 12px;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
  border-bottom: 1px solid #eef2f7;
  background: #fbfcfe;
}
.ver-table td {
  padding: 10px 12px;
  border-bottom: 1px solid #f1f5f9;
  color: #334155;
}
</style>
