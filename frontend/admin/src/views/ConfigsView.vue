<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import PageHead from '@/components/PageHead.vue';
import { ApiError } from '@/api/http';
import { fetchConfigs, updateConfig } from '@/api/admin';
import type { AdminConfigRow } from '@/api/admin';

const loading = ref(false);
const list = ref<AdminConfigRow[]>([]);
const draft = ref<Record<string, string>>({});

async function load() {
  loading.value = true;
  try {
    const rows = await fetchConfigs();
    list.value = rows;
    draft.value = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '加载失败');
  } finally {
    loading.value = false;
  }
}

async function onSave(row: AdminConfigRow) {
  const value = (draft.value[row.key] ?? '').trim();
  if (!value) {
    ElMessage.warning('参数值不能为空');
    return;
  }
  if (value === row.value) {
    ElMessage.info('参数值未变化');
    return;
  }
  try {
    await updateConfig(row.key, value);
    ElMessage.success(`已保存：${row.label} ${value}`);
    void load();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '保存失败');
  }
}

onMounted(() => void load());
</script>

<template>
  <div class="configs-page">
    <PageHead title="系统参数管理" desc="管理平台级运行参数（PRD A-12）" :tags="['文件大小', '超时', '分页']" />

    <div class="panel">
      <div class="panel-head"><h2>平台参数</h2><span class="sub">修改后即时生效 · 记录操作审计（A-13）</span></div>
      <div class="panel-body">
        <el-table v-loading="loading" :data="list" style="width: 100%">
          <el-table-column label="参数" width="220">
            <template #default="{ row }">
              <span class="cell-strong">{{ row.label }}</span>
              <div class="key muted">{{ row.key }}</div>
            </template>
          </el-table-column>
          <el-table-column label="当前值" width="220">
            <template #default="{ row }">
              <el-input v-model="draft[row.key]" maxlength="512" />
            </template>
          </el-table-column>
          <el-table-column label="说明" min-width="260">
            <template #default="{ row }"><span class="small muted">{{ row.remark ?? '—' }}</span></template>
          </el-table-column>
          <el-table-column label="操作" width="90">
            <template #default="{ row }">
              <el-button link type="primary" @click="onSave(row)">保存</el-button>
            </template>
          </el-table-column>
          <template #empty><div class="empty-state">暂无参数</div></template>
        </el-table>

        <div class="alert info mt12">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" stroke="currentColor" stroke-width="1.8" /></svg>
          参数取值范围校验，防止非法值导致系统异常；参数格式错误时拒绝保存并提示。
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel { background: #fff; border: 1px solid #eef2f7; border-radius: 14px; overflow: hidden; }
.panel-head { display: flex; align-items: baseline; gap: 10px; padding: 14px 20px 0; }
.panel-head h2 { font-size: 15px; font-weight: 600; color: #1e293b; margin: 0; }
.panel-head .sub { font-size: 12px; color: #94a3b8; }
.panel-body { padding: 14px 20px 20px; }
.cell-strong { font-weight: 600; color: #1e293b; }
.muted { color: #94a3b8; }
.key { font-size: 11px; margin-top: 2px; }
.small { font-size: 12px; }
.alert { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 10px; font-size: 12.5px; }
.alert.info { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
.mt12 { margin-top: 12px; }
.empty-state { padding: 32px 0; color: #94a3b8; font-size: 13px; }
</style>
