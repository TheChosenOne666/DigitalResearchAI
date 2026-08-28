<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHead from '@/components/PageHead.vue';
import { ApiError } from '@/api/http';
import { fetchDicts, createDict, updateDict, setDictEnabled } from '@/api/admin';
import type { AdminDictRow, DictType } from '@/api/admin';

const TYPES: Array<{ value: DictType; label: string }> = [
  { value: 'COUNTRY', label: '国家地区' },
  { value: 'ORG', label: '机构' },
  { value: 'INDUSTRY', label: '行业' },
  { value: 'UNIT', label: '单位' },
  { value: 'TIME', label: '时间粒度' },
];

const activeType = ref<DictType>('COUNTRY');
const loading = ref(false);
const list = ref<AdminDictRow[]>([]);
const total = ref(0);
const query = reactive({ keyword: '', page: 1, pageSize: 50 });

async function load() {
  loading.value = true;
  try {
    const res = await fetchDicts({ type: activeType.value, keyword: query.keyword, page: query.page, pageSize: query.pageSize });
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

watch(activeType, () => {
  query.keyword = '';
  query.page = 1;
  void load();
});

// ===== 新增 / 编辑 =====
const dialogVisible = ref(false);
const dialogMode = ref<'create' | 'edit'>('create');
const editId = ref('');
const saving = ref(false);
const form = reactive({ code: '', name: '', nameEn: '', parentCode: '', remark: '', sort: 0 });

function openCreate() {
  dialogMode.value = 'create';
  editId.value = '';
  Object.assign(form, { code: '', name: '', nameEn: '', parentCode: '', remark: '', sort: 0 });
  dialogVisible.value = true;
}

function openEdit(row: AdminDictRow) {
  dialogMode.value = 'edit';
  editId.value = row.id;
  Object.assign(form, {
    code: row.code,
    name: row.name,
    nameEn: row.nameEn ?? '',
    parentCode: row.parentCode ?? '',
    remark: row.remark ?? '',
    sort: row.sort ?? 0,
  });
  dialogVisible.value = true;
}

async function onSave() {
  if (!form.name) {
    ElMessage.warning('请填写名称');
    return;
  }
  if (dialogMode.value === 'create' && !form.code) {
    ElMessage.warning('请填写编码');
    return;
  }
  saving.value = true;
  try {
    if (dialogMode.value === 'create') {
      await createDict({ type: activeType.value, code: form.code, name: form.name, nameEn: form.nameEn || undefined, parentCode: form.parentCode || undefined, remark: form.remark || undefined, sort: form.sort });
      ElMessage.success('字典项已新增');
    } else {
      await updateDict(editId.value, { name: form.name, nameEn: form.nameEn || undefined, parentCode: form.parentCode || undefined, remark: form.remark || undefined, sort: form.sort });
      ElMessage.success('字典项已更新');
    }
    dialogVisible.value = false;
    void load();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

async function onToggle(row: AdminDictRow) {
  const target = !row.enabled;
  try {
    await ElMessageBox.confirm(`确认${target ? '启用' : '停用'}「${row.name}」？被引用时建议停用代替删除。`, target ? '启用字典项' : '停用字典项', {
      type: 'warning',
      confirmButtonText: target ? '启用' : '停用',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await setDictEnabled(row.id, target);
    ElMessage.success(target ? '已启用' : '已停用');
    void load();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '操作失败');
  }
}

onMounted(() => void load());
</script>

<template>
  <div class="dicts-page">
    <PageHead title="基础字典库" desc="维护检索与标准化所需字典（PRD A-06）" :tags="['国家地区', '机构', '行业', '单位', '时间粒度']" />

    <div class="panel">
      <div class="panel-body">
        <el-tabs v-model="activeType">
          <el-tab-pane v-for="t in TYPES" :key="t.value" :label="t.label" :name="t.value" />
        </el-tabs>

        <div class="toolbar">
          <el-input v-model="query.keyword" class="search-input" placeholder="按名称 / 编码搜索" clearable @keyup.enter="onSearch" @clear="onSearch">
            <template #prefix>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="1.8" /><path d="m16 16 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
            </template>
          </el-input>
          <span class="spacer"></span>
          <el-button type="primary" size="small" @click="openCreate">新增字典项</el-button>
        </div>

        <el-table v-loading="loading" :data="list" style="width: 100%">
          <el-table-column label="编码" width="120">
            <template #default="{ row }"><span class="cell-strong">{{ row.code }}</span></template>
          </el-table-column>
          <el-table-column label="名称" min-width="150">
            <template #default="{ row }">{{ row.name }}</template>
          </el-table-column>
          <el-table-column label="英文名" min-width="150">
            <template #default="{ row }"><span class="muted">{{ row.nameEn ?? '—' }}</span></template>
          </el-table-column>
          <el-table-column v-if="activeType === 'INDUSTRY'" label="上级编码" width="110">
            <template #default="{ row }"><span class="muted">{{ row.parentCode ?? '—' }}</span></template>
          </el-table-column>
          <el-table-column label="说明" min-width="160">
            <template #default="{ row }"><span class="muted">{{ row.remark ?? '—' }}</span></template>
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
              <el-button link :type="row.enabled ? 'danger' : 'success'" @click="onToggle(row)">{{ row.enabled ? '停用' : '启用' }}</el-button>
            </template>
          </el-table-column>
          <template #empty><div class="empty-state">暂无字典项</div></template>
        </el-table>

        <div class="alert-info">字典由系统内置预置，平台管理员可维护；字典项被引用时禁止删除，建议停用。</div>
      </div>
    </div>

    <el-dialog v-model="dialogVisible" :title="dialogMode === 'create' ? '新增字典项' : '编辑字典项'" width="480px" :close-on-click-modal="false">
      <el-form label-width="90px" label-position="left">
        <el-form-item label="编码" :required="dialogMode === 'create'">
          <el-input v-model="form.code" maxlength="64" :disabled="dialogMode === 'edit'" placeholder="同类型内唯一" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.name" maxlength="128" placeholder="字典项名称" />
        </el-form-item>
        <el-form-item label="英文名">
          <el-input v-model="form.nameEn" maxlength="128" placeholder="英文名（可空）" />
        </el-form-item>
        <el-form-item v-if="activeType === 'INDUSTRY'" label="上级编码">
          <el-input v-model="form.parentCode" maxlength="64" placeholder="如 I01（行业分层，可空）" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="form.remark" maxlength="255" placeholder="说明（可空）" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sort" :min="0" :max="9999" />
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
.search-input { width: 240px; }
.spacer { flex: 1; }
.cell-strong { font-weight: 600; color: #1e293b; }
.muted { color: #94a3b8; }
.status-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; vertical-align: 1px; }
.status-dot.on { background: #67c23a; }
.status-dot.off { background: #f56c6c; }
.alert-info { display: flex; align-items: center; gap: 6px; margin-top: 14px; padding: 10px 14px; border-radius: 8px; background: #f4f8ff; color: #5a7aa8; font-size: 12px; }
.empty-state { padding: 32px 0; color: #94a3b8; font-size: 13px; }
</style>
