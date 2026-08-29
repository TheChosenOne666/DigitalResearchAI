<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHead from '@/components/PageHead.vue';
import { ApiError } from '@/api/http';
import { fetchKbReviews, approveKbReview, rejectKbReview, fetchKbTrace } from '@/api/admin';
import type { KbReviewRow, KbTrace } from '@/api/admin';

const query = reactive({ keyword: '', page: 1, pageSize: 20 });
const loading = ref(false);
const list = ref<KbReviewRow[]>([]);
const total = ref(0);
const current = ref<KbReviewRow | null>(null);
const trace = ref<KbTrace | null>(null);
const traceLoading = ref(false);

async function load() {
  loading.value = true;
  try {
    const res = await fetchKbReviews(query);
    list.value = res.list;
    total.value = res.total;
    if (current.value && !res.list.some((r) => r.id === current.value?.id)) {
      current.value = null;
      trace.value = null;
    }
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

const CHECK_LABEL: Record<string, string> = { duplicate: '重复性', complete: '完整性', compliance: '合规性', format: '格式' };

/** 行高亮：当前选中条目 */
function rowClass({ row }: { row: KbReviewRow }) {
  return current.value?.id === row.id ? 'current-row' : '';
}

/** 汇总四项校验的展示态（有 FAIL 为不通过，有 WARN 为提醒，否则通过） */
function overallCheck(row: KbReviewRow): { tag: 'success' | 'warning' | 'danger'; text: string } {
  const items = Object.entries(row.checks) as Array<[string, { status: string; note: string }]>;
  if (items.some(([, c]) => c.status === 'FAIL')) return { tag: 'danger', text: '不通过' };
  if (items.some(([, c]) => c.status === 'WARN')) return { tag: 'warning', text: '提醒' };
  return { tag: 'success', text: '通过' };
}

function fmtTime(v: string) {
  return new Date(v).toLocaleString('zh-CN', { hour12: false });
}

/** 表格内短时间格式（避免列宽挤压） */
function fmtTimeShort(v: string) {
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function showTrace(row: KbReviewRow) {
  current.value = row;
  traceLoading.value = true;
  trace.value = null;
  try {
    trace.value = await fetchKbTrace(row.id);
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '溯源加载失败');
  } finally {
    traceLoading.value = false;
  }
}

async function onApprove(row: KbReviewRow) {
  try {
    const res = await approveKbReview(row.id);
    ElMessage.success(res.status === 'LEARNING' ? `「${row.name}」已通过，开始学习` : `「${row.name}」已通过（学习状态：${res.status}）`);
    if (current.value?.id === row.id) current.value = null;
    void load();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '审核失败');
  }
}

async function onReject(row: KbReviewRow) {
  let reason: string;
  try {
    const res = await ElMessageBox.prompt('请填写驳回原因（将记录审计日志）', `驳回「${row.name}」`, {
      type: 'warning',
      confirmButtonText: '确认驳回',
      cancelButtonText: '取消',
      inputPlaceholder: '例如：内容与知识库主题不符',
      inputValidator: (v: string) => (v && v.trim().length >= 2 ? true : '原因至少 2 个字符'),
    });
    reason = res.value.trim();
  } catch {
    return;
  }
  try {
    await rejectKbReview(row.id, reason);
    ElMessage.success(`「${row.name}」已驳回`);
    if (current.value?.id === row.id) current.value = null;
    void load();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '驳回失败');
  }
}

onMounted(() => void load());
</script>

<template>
  <div class="kb-review-page">
    <PageHead title="入库审核（知识审核）" desc="审核用户提交的知识条目（PRD A-16）" :tags="['审核队列', '内容校验', '通过驳回', '来源溯源']" />

    <div class="grid mb16">
      <div class="panel">
        <div class="panel-head"><h2>审核队列</h2><span class="sub">待审核知识条目 · 共 {{ total }} 条</span></div>
        <div class="panel-body">
          <div class="toolbar">
            <el-input v-model="query.keyword" class="search-input" placeholder="条目名称" clearable @keyup.enter="onSearch" @clear="onSearch">
              <template #prefix>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="1.8" /><path d="m16 16 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
              </template>
            </el-input>
            <span class="spacer"></span>
            <el-button size="small" @click="onSearch">刷新</el-button>
          </div>
          <el-table v-loading="loading" :data="list" style="width: 100%" :row-class-name="rowClass" @row-click="showTrace">
            <el-table-column label="条目" min-width="130">
              <template #default="{ row }">
                <div class="cell-strong ellipsis">{{ row.name }}</div>
                <div class="small muted">{{ row.tenantName ?? row.tenantId }} · {{ row.libraryName ?? '—' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="提交人" width="86">
              <template #default="{ row }">{{ row.submitter ?? '—' }}</template>
            </el-table-column>
            <el-table-column label="类型" width="78">
              <template #default="{ row }">
                <el-tag :type="row.sourceSessionId ? 'primary' : 'info'" effect="light" size="small">{{ row.sourceSessionId ? '数据条目' : '上传条目' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="时间" width="110">
              <template #default="{ row }">{{ fmtTimeShort(row.createdAt) }}</template>
            </el-table-column>
            <el-table-column label="校验" width="70">
              <template #default="{ row }">
                <el-tag :type="overallCheck(row).tag" effect="light" size="small">{{ overallCheck(row).text }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="118" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click.stop="onApprove(row)">通过</el-button>
                <el-button link type="danger" @click.stop="onReject(row)">驳回</el-button>
                <el-button link type="primary" @click.stop="showTrace(row)">溯源</el-button>
              </template>
            </el-table-column>
            <template #empty><div class="empty-state">暂无待审核条目</div></template>
          </el-table>
          <div class="pager">
            <el-pagination background layout="total, prev, pager, next" :total="total" :page-size="query.pageSize" :current-page="query.page" @current-change="onPageChange" />
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>内容校验</h2><span class="sub">重复性 · 完整性 · 合规性 · 格式</span></div>
        <div class="panel-body">
          <template v-if="current">
            <div class="item-list">
              <div v-for="(check, key) in current.checks" :key="key" class="item">
                <div class="item-head">
                  <span class="item-name">{{ CHECK_LABEL[key] ?? key }}</span>
                  <el-tag :type="check.status === 'PASS' ? 'success' : check.status === 'WARN' ? 'warning' : 'danger'" effect="light" size="small">{{ check.status === 'PASS' ? '通过' : check.status === 'WARN' ? '提醒' : '不通过' }}</el-tag>
                </div>
                <div class="small muted">{{ check.note }}</div>
              </div>
            </div>
          </template>
          <div v-else class="empty-state">点击左侧条目查看校验结果</div>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>来源溯源{{ current ? ` · ${current.name}` : '' }}</h2><span class="sub">入库来源 · 原始链接/数据源 · 提交人</span></div>
      <div class="panel-body">
        <div v-loading="traceLoading">
          <template v-if="trace">
            <div class="fields">
              <div class="field"><span class="f-label">入库来源</span><span>{{ trace.sourceType }}</span></div>
              <div class="field"><span class="f-label">数据源</span><span>{{ trace.sourceQuestion ?? '—' }}</span></div>
              <div class="field"><span class="f-label">原始链接</span><span>{{ trace.sourceLink ?? '—' }}</span></div>
              <div class="field"><span class="f-label">提交人</span><span>{{ trace.submitter?.name ?? '—' }}</span></div>
            </div>
            <div class="fields mt12">
              <div class="field"><span class="f-label">所属租户</span><span>{{ trace.tenantName ?? '—' }}</span></div>
              <div class="field"><span class="f-label">所属库 / 分组</span><span>{{ trace.libraryName ?? '—' }}{{ trace.groupName ? ` / ${trace.groupName}` : '' }}</span></div>
              <div class="field"><span class="f-label">标签</span><span>{{ trace.tags.length ? trace.tags.join('、') : '—' }}</span></div>
              <div class="field"><span class="f-label">提交时间</span><span>{{ fmtTime(trace.createdAt) }}</span></div>
            </div>
            <div class="actions mt12">
              <el-button size="small" type="primary" @click="onApprove(current!)">通过</el-button>
              <el-button size="small" type="danger" @click="onReject(current!)">驳回</el-button>
            </div>
          </template>
          <div v-else-if="!traceLoading" class="empty-state">点击上方条目查看来源溯源</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; }
.panel { background: #fff; border: 1px solid #eef2f7; border-radius: 14px; overflow: hidden; margin-bottom: 16px; }
.panel-head { display: flex; align-items: baseline; gap: 10px; padding: 14px 20px 0; }
.panel-head h2 { font-size: 15px; font-weight: 600; color: #1e293b; margin: 0; }
.panel-head .sub { font-size: 12px; color: #94a3b8; }
.panel-body { padding: 14px 20px 20px; }
.mb16 { margin-bottom: 16px; }
.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.search-input { width: 200px; }
.spacer { flex: 1; }
.cell-strong { font-weight: 600; color: #1e293b; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.muted { color: #94a3b8; }
.small { font-size: 12px; color: #475569; }
.item-list { display: flex; flex-direction: column; gap: 12px; }
.item { border: 1px solid #eef2f7; border-radius: 10px; padding: 10px 14px; }
.item-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.item-name { font-size: 13px; font-weight: 600; color: #1e293b; }
.fields { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #1e293b; }
.f-label { font-size: 12px; color: #94a3b8; }
.actions { display: flex; gap: 8px; }
.mt12 { margin-top: 12px; }
.pager { display: flex; justify-content: flex-end; margin-top: 16px; }
.empty-state { padding: 32px 0; color: #94a3b8; font-size: 13px; text-align: center; }
:deep(.el-table .current-row) { cursor: pointer; }
.el-table :deep(tbody tr) { cursor: pointer; }
</style>
