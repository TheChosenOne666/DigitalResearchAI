<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHead from '@/components/PageHead.vue';
import { ApiError } from '@/api/http';
import { fetchKbPermissionRule, updateKbPermissionRule, fetchKbPermissionItems, setKbItemVisibility } from '@/api/admin';
import type { KbPermissionItemRow } from '@/api/admin';

const DEFAULT_VISIBILITY: Record<string, string> = {
  PUBLIC: '公开（所有用户可见可检索）',
  PRIVATE: '私有（仅指定范围可见）',
  ORG: '组织（提交人所属组织可见）',
};

const PRIVATE_SCOPE: Record<string, string> = {
  SUBMITTER: '提交人本人',
  ORG: '提交人所属组织',
  ADMIN: '管理员',
};

const ruleLoading = ref(false);
const ruleSaving = ref(false);
const rule = ref<{ defaultVisibility: string; privateScope: string }>({ defaultVisibility: 'PRIVATE', privateScope: 'SUBMITTER' });

async function loadRule() {
  ruleLoading.value = true;
  try {
    rule.value = await fetchKbPermissionRule();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '规则加载失败');
  } finally {
    ruleLoading.value = false;
  }
}

async function saveRule() {
  ruleSaving.value = true;
  try {
    rule.value = await updateKbPermissionRule({ defaultVisibility: rule.value.defaultVisibility, privateScope: rule.value.privateScope });
    ElMessage.success('权限规则已保存，对新入库条目生效');
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '保存失败');
  } finally {
    ruleSaving.value = false;
  }
}

// ===== 条目权限列表 =====
const query = reactive({ keyword: '', visibility: '', page: 1, pageSize: 20 });
const loading = ref(false);
const list = ref<KbPermissionItemRow[]>([]);
const total = ref(0);

async function loadItems() {
  loading.value = true;
  try {
    const res = await fetchKbPermissionItems(query);
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
  void loadItems();
}

function onPageChange(p: number) {
  query.page = p;
  void loadItems();
}

function scopeText(row: KbPermissionItemRow) {
  if (row.visibility === 'PUBLIC') return '所有用户';
  return `私有（默认范围：${PRIVATE_SCOPE[rule.value.privateScope] ?? rule.value.privateScope}）`;
}

async function toggleVisibility(row: KbPermissionItemRow) {
  const to = row.visibility === 'PUBLIC' ? 'PRIVATE' : 'PUBLIC';
  if (to === 'PRIVATE') {
    try {
      await ElMessageBox.confirm(
        `切换私有需二次确认：条目「${row.name}」原分享链接对未授权用户失效。`,
        '设为私有',
        { type: 'warning', confirmButtonText: '确认设为私有', cancelButtonText: '取消' },
      );
    } catch {
      return;
    }
  } else {
    try {
      await ElMessageBox.confirm(`确认将条目「${row.name}」设为公开？所有用户可见可检索。`, '设为公开', {
        type: 'warning',
        confirmButtonText: '确认设为公开',
        cancelButtonText: '取消',
      });
    } catch {
      return;
    }
  }
  try {
    await setKbItemVisibility(row.id, to);
    ElMessage.success(`「${row.name}」已${to === 'PUBLIC' ? '设为公开' : '设为私有'}`);
    void loadItems();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '切换失败');
  }
}

function fmtTime(v: string) {
  return new Date(v).toLocaleString('zh-CN', { hour12: false });
}

onMounted(() => {
  void loadRule();
  void loadItems();
});
</script>

<template>
  <div class="kb-permission-page">
    <PageHead title="知识权限配置" desc="配置知识条目可见范围（PRD A-18）" :tags="['公开', '私有权限']" />

    <div class="panel mb16">
      <div class="panel-head"><h2>权限规则</h2><span class="sub">条目级权限 · 私有支持指定用户/组织 · 新入库条目按默认规则生效</span></div>
      <div v-loading="ruleLoading" class="panel-body">
        <div class="rule-form">
          <div class="rule-item">
            <span class="r-label">默认权限</span>
            <el-select v-model="rule.defaultVisibility" class="w280">
              <el-option v-for="(label, key) in DEFAULT_VISIBILITY" :key="key" :label="label" :value="key" />
            </el-select>
          </div>
          <div class="rule-item">
            <span class="r-label">私有可见维度</span>
            <el-select v-model="rule.privateScope" class="w280">
              <el-option v-for="(label, key) in PRIVATE_SCOPE" :key="key" :label="label" :value="key" />
            </el-select>
          </div>
          <el-button type="primary" :loading="ruleSaving" @click="saveRule">保存规则</el-button>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>条目权限列表</h2><span class="sub">公开 → 私有 切换需二次确认</span></div>
      <div class="panel-body">
        <div class="toolbar">
          <el-input v-model="query.keyword" class="search-input" placeholder="条目名称" clearable @keyup.enter="onSearch" @clear="onSearch">
            <template #prefix>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="1.8" /><path d="m16 16 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
            </template>
          </el-input>
          <el-select v-model="query.visibility" class="w140" clearable placeholder="全部权限" @change="onSearch">
            <el-option label="公开" value="PUBLIC" />
            <el-option label="私有" value="PRIVATE" />
          </el-select>
          <span class="spacer"></span>
          <el-button size="small" @click="onSearch">刷新</el-button>
        </div>
        <el-table v-loading="loading" :data="list" style="width: 100%">
          <el-table-column label="条目" min-width="220">
            <template #default="{ row }"><span class="cell-strong">{{ row.name }}</span></template>
          </el-table-column>
          <el-table-column label="所属" min-width="160">
            <template #default="{ row }"><span class="small muted">{{ row.tenantName ?? '—' }} · {{ row.libraryName ?? '—' }}</span></template>
          </el-table-column>
          <el-table-column label="当前权限" width="100">
            <template #default="{ row }">
              <el-tag :type="row.visibility === 'PUBLIC' ? 'success' : 'info'" effect="light" size="small">{{ row.visibility === 'PUBLIC' ? '公开' : '私有' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="可见范围" min-width="160">
            <template #default="{ row }">{{ scopeText(row) }}</template>
          </el-table-column>
          <el-table-column label="更新时间" width="170">
            <template #default="{ row }">{{ fmtTime(row.updatedAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="110" fixed="right">
            <template #default="{ row }">
              <el-button link :type="row.visibility === 'PUBLIC' ? 'danger' : 'success'" @click="toggleVisibility(row)">
                {{ row.visibility === 'PUBLIC' ? '设为私有' : '设为公开' }}
              </el-button>
            </template>
          </el-table-column>
          <template #empty><div class="empty-state">暂无条目数据</div></template>
        </el-table>
        <div class="note">权限配置作用于用户端知识库浏览（U-10/U-13）与检索匹配（U-12）。</div>
        <div class="pager">
          <el-pagination background layout="total, prev, pager, next" :total="total" :page-size="query.pageSize" :current-page="query.page" @current-change="onPageChange" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel { background: #fff; border: 1px solid #eef2f7; border-radius: 14px; overflow: hidden; margin-bottom: 16px; }
.panel-head { display: flex; align-items: baseline; gap: 10px; padding: 14px 20px 0; }
.panel-head h2 { font-size: 15px; font-weight: 600; color: #1e293b; margin: 0; }
.panel-head .sub { font-size: 12px; color: #94a3b8; }
.panel-body { padding: 14px 20px 20px; }
.mb16 { margin-bottom: 16px; }
.rule-form { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.rule-item { display: flex; align-items: center; gap: 8px; }
.r-label { font-size: 13px; color: #475569; }
.w280 { width: 280px; }
.w140 { width: 140px; }
.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.search-input { width: 200px; }
.spacer { flex: 1; }
.cell-strong { font-weight: 600; color: #1e293b; }
.muted { color: #94a3b8; }
.small { font-size: 12px; color: #475569; }
.note { margin-top: 12px; font-size: 12px; color: #94a3b8; }
.pager { display: flex; justify-content: flex-end; margin-top: 16px; }
.empty-state { padding: 32px 0; color: #94a3b8; font-size: 13px; }
</style>
