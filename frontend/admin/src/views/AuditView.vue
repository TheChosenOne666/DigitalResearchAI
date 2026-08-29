<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import PageHead from '@/components/PageHead.vue';
import { ApiError } from '@/api/http';
import { fetchAudit } from '@/api/admin';
import type { AdminAuditRow } from '@/api/admin';

type Tab = 'login' | 'export' | 'delete';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'login', label: '登录日志' },
  { key: 'export', label: '导出日志' },
  { key: 'delete', label: '删除日志' },
];

const activeTab = ref<Tab>('login');
const query = reactive({ keyword: '', result: '', days: 7, page: 1, pageSize: 20 });
const loading = ref(false);
const list = ref<AdminAuditRow[]>([]);
const total = ref(0);

async function load() {
  loading.value = true;
  try {
    const res = await fetchAudit({ tab: activeTab.value, keyword: query.keyword, result: query.result, days: query.days, page: query.page, pageSize: query.pageSize });
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

function fmtTime(v: string) {
  return new Date(v).toLocaleString('zh-CN', { hour12: false });
}

function detailText(row: AdminAuditRow, key: string): string {
  const v = row.detail?.[key];
  return typeof v === 'string' ? v : '—';
}

watch(activeTab, () => {
  query.page = 1;
  void load();
});

onMounted(() => void load());
</script>

<template>
  <div class="audit-page">
    <PageHead title="操作审计" desc="查询重要业务与管理操作（PRD A-13）" :tags="['登录', '导出', '删除日志']" />

    <div class="panel mb16">
      <div class="panel-body">
        <el-tabs v-model="activeTab">
          <el-tab-pane v-for="t in TABS" :key="t.key" :label="t.label" :name="t.key" />
        </el-tabs>
        <div class="toolbar">
          <el-input v-model="query.keyword" class="search-input" placeholder="按用户 / IP 查询" clearable @keyup.enter="onSearch" @clear="onSearch">
            <template #prefix>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="1.8" /><path d="m16 16 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
            </template>
          </el-input>
          <el-select v-model="query.days" class="w140" @change="onSearch">
            <el-option label="近 7 日" :value="7" />
            <el-option label="近 30 日" :value="30" />
            <el-option label="近 90 日" :value="90" />
          </el-select>
          <el-select v-model="query.result" class="w130" clearable placeholder="全部结果" @change="onSearch">
            <el-option label="成功" value="success" />
            <el-option label="失败" value="fail" />
          </el-select>
          <span class="spacer"></span>
          <el-button size="small" @click="onSearch">刷新</el-button>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h2>{{ TABS.find((t) => t.key === activeTab)?.label }}</h2>
        <span class="sub">{{ activeTab === 'login' ? '用户 · 时间 · IP · 结果' : activeTab === 'export' ? '用户 · 内容 · 时间' : '用户 · 对象 · 时间' }}</span>
      </div>
      <div class="panel-body">
        <el-table v-loading="loading" :data="list" style="width: 100%">
          <el-table-column label="用户" width="160">
            <template #default="{ row }"><span class="cell-strong">{{ row.user ?? '未知用户' }}</span></template>
          </el-table-column>

          <template v-if="activeTab === 'login'">
            <el-table-column label="时间" width="180">
              <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
            </el-table-column>
            <el-table-column label="IP" width="170">
              <template #default="{ row }">{{ row.ip ?? '—' }}</template>
            </el-table-column>
            <el-table-column label="结果" min-width="160">
              <template #default="{ row }">
                <el-tag :type="row.success ? 'success' : 'danger'" effect="light" size="small">{{ row.success ? '成功' : `失败 · ${detailText(row, 'reason')}` }}</el-tag>
              </template>
            </el-table-column>
          </template>

          <template v-else-if="activeTab === 'export'">
            <el-table-column label="导出内容" min-width="240">
              <template #default="{ row }">{{ detailText(row, 'type') }}</template>
            </el-table-column>
            <el-table-column label="格式" width="110">
              <template #default="{ row }">
                <el-tag type="primary" effect="light" size="small">{{ detailText(row, 'format') }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="时间" width="180">
              <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
            </el-table-column>
          </template>

          <template v-else>
            <el-table-column label="删除对象" min-width="240">
              <template #default="{ row }">{{ detailText(row, 'targetName') !== '—' ? detailText(row, 'targetName') : detailText(row, 'type') }}</template>
            </el-table-column>
            <el-table-column label="类型" width="110">
              <template #default="{ row }">
                <el-tag effect="light" size="small">{{ detailText(row, 'type') }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="时间" width="180">
              <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
            </el-table-column>
          </template>

          <template #empty><div class="empty-state">该时间范围内暂无日志</div></template>
        </el-table>

        <div class="alert info mt12">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" stroke-width="1.8" /><path d="M8 10V7a4 4 0 1 1 8 0v3" stroke="currentColor" stroke-width="1.8" /></svg>
          日志只读不可修改；保留时长至少 180 天；日志量大时支持分页与条件查询。
        </div>

        <div class="pager">
          <el-pagination background layout="total, prev, pager, next" :total="total" :page-size="query.pageSize" :current-page="query.page" @current-change="onPageChange" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel { background: #fff; border: 1px solid #eef2f7; border-radius: 14px; overflow: hidden; }
.mb16 { margin-bottom: 16px; }
.panel-head { display: flex; align-items: baseline; gap: 10px; padding: 14px 20px 0; }
.panel-head h2 { font-size: 15px; font-weight: 600; color: #1e293b; margin: 0; }
.panel-head .sub { font-size: 12px; color: #94a3b8; }
.panel-body { padding: 6px 20px 20px; }
.toolbar { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
.search-input { width: 220px; }
.w140 { width: 140px; }
.w130 { width: 130px; }
.spacer { flex: 1; }
.cell-strong { font-weight: 600; color: #1e293b; }
.alert { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 10px; font-size: 12.5px; }
.alert.info { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
.mt12 { margin-top: 12px; }
.pager { display: flex; justify-content: flex-end; margin-top: 16px; }
.empty-state { padding: 32px 0; color: #94a3b8; font-size: 13px; }
</style>
