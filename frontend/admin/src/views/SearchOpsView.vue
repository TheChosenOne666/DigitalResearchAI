<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHead from '@/components/PageHead.vue';
import { ApiError } from '@/api/http';
import { fetchSearchTerms, setTermFlags, fetchSensitive, createSensitive, updateSensitive, setSensitiveEnabled } from '@/api/admin';
import type { AdminSearchTermRow, AdminSensitiveRow } from '@/api/admin';

const SENSITIVE_TYPE_LABEL: Record<string, string> = {
  POLITICS: '涉政',
  ILLEGAL: '违法',
  OTHER: '其他',
};

const activeTab = ref<'hot' | 'empty' | 'sensitive'>('hot');

// ===== 搜索词 =====
const termLoading = ref(false);
const termList = ref<AdminSearchTermRow[]>([]);
const termTotal = ref(0);
const termQuery = reactive({ page: 1, pageSize: 20 });

async function loadTerms() {
  termLoading.value = true;
  try {
    const kind = activeTab.value === 'empty' ? 'empty' : 'hot';
    const res = await fetchSearchTerms(kind, termQuery.page, termQuery.pageSize);
    termList.value = res.list;
    termTotal.value = res.total;
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '加载失败');
  } finally {
    termLoading.value = false;
  }
}

function onTermPageChange(p: number) {
  termQuery.page = p;
  void loadTerms();
}

async function toggleFlag(row: AdminSearchTermRow, flag: 'isQuick' | 'isSuggest') {
  const current = row[flag];
  try {
    await setTermFlags(row.id, { [flag]: !current });
    ElMessage.success(flag === 'isQuick' ? (current ? '已取消快捷检索' : '已设为快捷检索') : current ? '已取消搜索建议' : '已加入搜索建议');
    void loadTerms();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '操作失败');
  }
}

// ===== 敏感词 =====
const sensitiveLoading = ref(false);
const sensitiveList = ref<AdminSensitiveRow[]>([]);
const sensitiveTotal = ref(0);
const sensitiveQuery = reactive({ keyword: '', enabled: '', page: 1, pageSize: 20 });

async function loadSensitive() {
  sensitiveLoading.value = true;
  try {
    const res = await fetchSensitive(sensitiveQuery);
    sensitiveList.value = res.list;
    sensitiveTotal.value = res.total;
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '加载失败');
  } finally {
    sensitiveLoading.value = false;
  }
}

function onSensitiveSearch() {
  sensitiveQuery.page = 1;
  void loadSensitive();
}

function onSensitivePageChange(p: number) {
  sensitiveQuery.page = p;
  void loadSensitive();
}

const dialogVisible = ref(false);
const dialogMode = ref<'create' | 'edit'>('create');
const editId = ref('');
const saving = ref(false);
const form = reactive({ word: '', type: 'POLITICS' });

function openCreate() {
  dialogMode.value = 'create';
  editId.value = '';
  Object.assign(form, { word: '', type: 'POLITICS' });
  dialogVisible.value = true;
}

function openEdit(row: AdminSensitiveRow) {
  dialogMode.value = 'edit';
  editId.value = row.id;
  Object.assign(form, { word: row.word, type: row.type });
  dialogVisible.value = true;
}

async function onSave() {
  if (!form.word) {
    ElMessage.warning('请填写敏感词');
    return;
  }
  saving.value = true;
  try {
    if (dialogMode.value === 'create') {
      await createSensitive({ ...form });
      ElMessage.success('敏感词已新增');
    } else {
      await updateSensitive(editId.value, { ...form });
      ElMessage.success('敏感词已更新');
    }
    dialogVisible.value = false;
    void loadSensitive();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

async function onToggleSensitive(row: AdminSensitiveRow) {
  const target = !row.enabled;
  try {
    await ElMessageBox.confirm(`确认${target ? '启用' : '停用'}敏感词「${row.word}」？停用后不再拦截。`, target ? '启用敏感词' : '停用敏感词', {
      type: 'warning',
      confirmButtonText: target ? '启用' : '停用',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await setSensitiveEnabled(row.id, target);
    ElMessage.success(target ? '已启用' : '已停用');
    void loadSensitive();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '操作失败');
  }
}

watch(activeTab, (tab) => {
  if (tab === 'sensitive') {
    void loadSensitive();
  } else {
    termQuery.page = 1;
    void loadTerms();
  }
});

onMounted(() => void loadTerms());
</script>

<template>
  <div class="search-ops-page">
    <PageHead title="搜索词管理" desc="分析并优化用户查询（PRD A-10）" :tags="['热门词', '无结果词', '敏感词']" />

    <div class="panel">
      <div class="panel-body">
        <el-tabs v-model="activeTab">
          <el-tab-pane label="热门词" name="hot" />
          <el-tab-pane label="无结果词" name="empty" />
          <el-tab-pane label="敏感词" name="sensitive" />
        </el-tabs>

        <!-- 热门词 / 无结果词 -->
        <template v-if="activeTab !== 'sensitive'">
          <div class="toolbar">
            <span class="sub-tip">{{ activeTab === 'hot' ? '按检索频次统计，辅助配置快捷检索/搜索建议' : '无结果词按「返回结果数为 0」统计，分析原因并优化' }}</span>
            <span class="spacer"></span>
          </div>
          <el-table v-loading="termLoading" :data="termList" style="width: 100%">
            <el-table-column v-if="activeTab === 'hot'" label="排名" width="70" align="center">
              <template #default="{ $index }"><span class="rank">{{ (termQuery.page - 1) * termQuery.pageSize + $index + 1 }}</span></template>
            </el-table-column>
            <el-table-column label="搜索词" min-width="200">
              <template #default="{ row }"><span class="cell-strong">{{ row.term }}</span></template>
            </el-table-column>
            <el-table-column :label="activeTab === 'hot' ? '检索频次' : '无结果频次'" width="110" align="center">
              <template #default="{ row }"><span class="num">{{ activeTab === 'hot' ? row.totalCount : row.emptyCount }}</span></template>
            </el-table-column>
            <el-table-column label="最近检索时间" width="160">
              <template #default="{ row }">{{ row.lastSearchedAt ? new Date(row.lastSearchedAt).toLocaleString() : '—' }}</template>
            </el-table-column>
            <el-table-column v-if="activeTab === 'hot'" label="运营标记" width="170">
              <template #default="{ row }">
                <el-tag v-if="row.isQuick" type="primary" effect="light" size="small">快捷检索</el-tag>
                <el-tag v-if="row.isSuggest" type="success" effect="light" size="small">搜索建议</el-tag>
                <span v-if="!row.isQuick && !row.isSuggest" class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="运营动作" width="220" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="toggleFlag(row, 'isQuick')">{{ row.isQuick ? '取消快捷检索' : '设为快捷检索' }}</el-button>
                <el-button link type="success" @click="toggleFlag(row, 'isSuggest')">{{ row.isSuggest ? '取消搜索建议' : '加入搜索建议' }}</el-button>
              </template>
            </el-table-column>
            <template #empty><div class="empty-state">暂无搜索词数据</div></template>
          </el-table>

          <div class="pager">
            <el-pagination background layout="total, prev, pager, next" :total="termTotal" :page-size="termQuery.pageSize" :current-page="termQuery.page" @current-change="onTermPageChange" />
          </div>
        </template>

        <!-- 敏感词 -->
        <template v-else>
          <div class="toolbar">
            <el-input v-model="sensitiveQuery.keyword" class="search-input" placeholder="按敏感词搜索" clearable @keyup.enter="onSensitiveSearch" @clear="onSensitiveSearch">
              <template #prefix>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="1.8" /><path d="m16 16 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
              </template>
            </el-input>
            <span class="sub-tip">命中策略：拦截该次检索并提示，记录日志供审计</span>
            <span class="spacer"></span>
            <el-button type="primary" size="small" @click="openCreate">新增敏感词</el-button>
          </div>
          <el-table v-loading="sensitiveLoading" :data="sensitiveList" style="width: 100%">
            <el-table-column label="敏感词" min-width="160">
              <template #default="{ row }"><span class="cell-strong">{{ row.word }}</span></template>
            </el-table-column>
            <el-table-column label="类型" width="100">
              <template #default="{ row }">
                <el-tag :type="row.type === 'POLITICS' ? 'danger' : row.type === 'ILLEGAL' ? 'warning' : 'info'" effect="light" size="small">
                  {{ SENSITIVE_TYPE_LABEL[row.type] ?? row.type }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="命中次数" width="100" align="center">
              <template #default="{ row }"><span class="num">{{ row.hitCount }}</span></template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <span class="status-dot" :class="row.enabled ? 'on' : 'off'"></span>
                {{ row.enabled ? '启用' : '停用' }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="130" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
                <el-button link :type="row.enabled ? 'danger' : 'success'" @click="onToggleSensitive(row)">{{ row.enabled ? '停用' : '启用' }}</el-button>
              </template>
            </el-table-column>
            <template #empty><div class="empty-state">暂无敏感词</div></template>
          </el-table>

          <div class="pager">
            <el-pagination background layout="total, prev, pager, next" :total="sensitiveTotal" :page-size="sensitiveQuery.pageSize" :current-page="sensitiveQuery.page" @current-change="onSensitivePageChange" />
          </div>
        </template>
      </div>
    </div>

    <!-- 敏感词新增/编辑 -->
    <el-dialog v-model="dialogVisible" :title="dialogMode === 'create' ? '新增敏感词' : '编辑敏感词'" width="440px" :close-on-click-modal="false">
      <el-form label-width="80px" label-position="left">
        <el-form-item label="敏感词" required>
          <el-input v-model="form.word" maxlength="128" placeholder="命中即拦截该次检索" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="form.type" style="width: 100%">
            <el-option label="涉政" value="POLITICS" />
            <el-option label="违法" value="ILLEGAL" />
            <el-option label="其他" value="OTHER" />
          </el-select>
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
.panel-body { padding: 16px 20px 20px; }
.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.search-input { width: 220px; }
.sub-tip { font-size: 12px; color: #94a3b8; }
.spacer { flex: 1; }
.cell-strong { font-weight: 600; color: #1e293b; }
.muted { color: #94a3b8; }
.num { font-weight: 600; color: #1e293b; }
.rank { font-weight: 600; color: #409eff; }
.status-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; vertical-align: 1px; }
.status-dot.on { background: #67c23a; }
.status-dot.off { background: #f56c6c; }
.pager { display: flex; justify-content: flex-end; margin-top: 16px; }
.empty-state { padding: 32px 0; color: #94a3b8; font-size: 13px; }
</style>
