<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHead from '@/components/PageHead.vue';
import { ApiError } from '@/api/http';
import {
  fetchIndicators,
  createIndicator,
  updateIndicator,
  removeIndicator,
  fetchMappings,
  createMapping,
  updateMapping,
  removeMapping,
} from '@/api/admin';
import type { AdminIndicatorRow, AdminMappingRow } from '@/api/admin';

const CATEGORY_OPTIONS = ['宏观经济', '对外贸易', '行业数据', '能源'];

const loading = ref(false);
const list = ref<AdminIndicatorRow[]>([]);
const total = ref(0);
const query = reactive({ keyword: '', category: '', enabled: '', page: 1, pageSize: 20 });

async function load() {
  loading.value = true;
  try {
    const res = await fetchIndicators(query);
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

// ===== 新增 / 编辑指标 =====
const dialogVisible = ref(false);
const dialogMode = ref<'create' | 'edit'>('create');
const editId = ref('');
const saving = ref(false);
const form = reactive({ code: '', name: '', category: '', unit: '', definition: '', enabled: true });

function openCreate() {
  dialogMode.value = 'create';
  editId.value = '';
  Object.assign(form, { code: '', name: '', category: '', unit: '', definition: '', enabled: true });
  dialogVisible.value = true;
}

function openEdit(row: AdminIndicatorRow) {
  dialogMode.value = 'edit';
  editId.value = row.id;
  Object.assign(form, {
    code: row.code,
    name: row.name,
    category: row.category,
    unit: row.unit,
    definition: row.definition ?? '',
    enabled: row.enabled,
  });
  dialogVisible.value = true;
}

async function onSave() {
  if (!form.code || !form.name || !form.category || !form.unit) {
    ElMessage.warning('请填写编码、名称、分类与单位');
    return;
  }
  saving.value = true;
  try {
    if (dialogMode.value === 'create') {
      await createIndicator({ ...form });
      ElMessage.success('指标已创建');
    } else {
      await updateIndicator(editId.value, { ...form });
      ElMessage.success('指标已更新');
    }
    dialogVisible.value = false;
    void load();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

async function onRemove(row: AdminIndicatorRow) {
  try {
    await ElMessageBox.confirm(`确认删除指标「${row.code}」？存在来源映射时将被拒绝删除。`, '删除指标', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await removeIndicator(row.id);
    ElMessage.success('指标已删除');
    if (currentIndicator.value?.id === row.id) currentIndicator.value = null;
    void load();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '删除失败');
  }
}

// ===== 来源映射 =====
const currentIndicator = ref<AdminIndicatorRow | null>(null);
const mappings = ref<AdminMappingRow[]>([]);
const mappingLoading = ref(false);

async function openMappings(row: AdminIndicatorRow) {
  currentIndicator.value = row;
  mappingLoading.value = true;
  try {
    mappings.value = await fetchMappings(row.id);
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '加载映射失败');
  } finally {
    mappingLoading.value = false;
  }
}

const mappingDialogVisible = ref(false);
const mappingMode = ref<'create' | 'edit'>('create');
const mappingEditId = ref('');
const mappingSaving = ref(false);
const mappingForm = reactive({ sourceName: '', sourceField: '', transform: '', enabled: true });

function openCreateMapping() {
  mappingMode.value = 'create';
  mappingEditId.value = '';
  Object.assign(mappingForm, { sourceName: '', sourceField: '', transform: '', enabled: true });
  mappingDialogVisible.value = true;
}

function openEditMapping(row: AdminMappingRow) {
  mappingMode.value = 'edit';
  mappingEditId.value = row.id;
  Object.assign(mappingForm, {
    sourceName: row.sourceName,
    sourceField: row.sourceField,
    transform: row.transform ?? '',
    enabled: row.enabled,
  });
  mappingDialogVisible.value = true;
}

async function onSaveMapping() {
  if (!mappingForm.sourceName || !mappingForm.sourceField) {
    ElMessage.warning('请填写数据源名称与来源字段');
    return;
  }
  if (!currentIndicator.value) return;
  mappingSaving.value = true;
  try {
    if (mappingMode.value === 'create') {
      await createMapping(currentIndicator.value.id, { ...mappingForm });
      ElMessage.success('映射已新增');
    } else {
      await updateMapping(currentIndicator.value.id, mappingEditId.value, { ...mappingForm });
      ElMessage.success('映射已更新');
    }
    mappingDialogVisible.value = false;
    void openMappings(currentIndicator.value);
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '保存失败');
  } finally {
    mappingSaving.value = false;
  }
}

async function onRemoveMapping(row: AdminMappingRow) {
  if (!currentIndicator.value) return;
  try {
    await ElMessageBox.confirm(`确认删除映射「${row.sourceName}」？`, '删除映射', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await removeMapping(currentIndicator.value.id, row.id);
    ElMessage.success('映射已删除');
    void openMappings(currentIndicator.value);
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '删除失败');
  }
}

onMounted(() => void load());
</script>

<template>
  <div class="indicators-page">
    <PageHead title="标准指标库" desc="维护统一指标及来源映射（PRD A-05）" :tags="['指标名称', '编码', '定义', '单位', '分类', '来源映射']" />

    <div class="panel filter-panel">
      <div class="toolbar">
        <el-input v-model="query.keyword" class="search-input" placeholder="按名称 / 编码搜索" clearable @keyup.enter="onSearch" @clear="onSearch">
          <template #prefix>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="1.8" /><path d="m16 16 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
          </template>
        </el-input>
        <el-select v-model="query.category" placeholder="全部分类" clearable class="filter-select" @change="onSearch">
          <el-option v-for="c in CATEGORY_OPTIONS" :key="c" :label="c" :value="c" />
        </el-select>
        <el-select v-model="query.enabled" placeholder="全部状态" clearable class="filter-select" @change="onSearch">
          <el-option label="启用" value="true" />
          <el-option label="停用" value="false" />
        </el-select>
        <span class="spacer"></span>
        <el-button type="primary" @click="openCreate">新增指标</el-button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>指标列表</h2><span class="sub">编码全局唯一 · 停用不影响历史数据</span></div>
      <div class="panel-body">
        <el-table v-loading="loading" :data="list" style="width: 100%">
          <el-table-column label="指标编码" width="130">
            <template #default="{ row }"><span class="cell-strong">{{ row.code }}</span></template>
          </el-table-column>
          <el-table-column label="指标名称" min-width="150">
            <template #default="{ row }">{{ row.name }}</template>
          </el-table-column>
          <el-table-column label="分类" width="110">
            <template #default="{ row }">{{ row.category }}</template>
          </el-table-column>
          <el-table-column label="单位" width="110">
            <template #default="{ row }">{{ row.unit }}</template>
          </el-table-column>
          <el-table-column label="定义 / 口径" min-width="180">
            <template #default="{ row }"><span class="muted">{{ row.definition ?? '—' }}</span></template>
          </el-table-column>
          <el-table-column label="来源映射" width="110">
            <template #default="{ row }">
              <el-tag v-if="row.mappingCount > 0" type="primary" effect="light" size="small">{{ row.mappingCount }} 个来源</el-tag>
              <span v-else class="muted">无映射</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="190" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button link type="primary" @click="openMappings(row)">映射</el-button>
              <el-button link type="danger" @click="onRemove(row)">删除</el-button>
            </template>
          </el-table-column>
          <template #empty><div class="empty-state">暂无指标数据</div></template>
        </el-table>

        <div class="pager">
          <el-pagination background layout="total, prev, pager, next" :total="total" :page-size="query.pageSize" :current-page="query.page" @current-change="onPageChange" />
        </div>
      </div>
    </div>

    <div v-if="currentIndicator" class="panel">
      <div class="panel-head">
        <h2>来源映射 · {{ currentIndicator.code }}</h2>
        <span class="sub">支撑全维度数据标准化（U-04）</span>
        <el-button size="small" type="primary" @click="openCreateMapping">新增映射</el-button>
      </div>
      <div class="panel-body">
        <el-table v-loading="mappingLoading" :data="mappings" style="width: 100%">
          <el-table-column label="数据源" min-width="160">
            <template #default="{ row }">{{ row.sourceName }}</template>
          </el-table-column>
          <el-table-column label="来源字段" min-width="160">
            <template #default="{ row }"><span class="muted">{{ row.sourceField }}</span></template>
          </el-table-column>
          <el-table-column label="换算/处理" min-width="120">
            <template #default="{ row }"><span class="muted">{{ row.transform ?? '直接映射' }}</span></template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag v-if="row.enabled" type="success" effect="light" size="small">启用</el-tag>
              <el-tag v-else type="info" effect="plain" size="small">停用</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="130" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openEditMapping(row)">编辑</el-button>
              <el-button link type="danger" @click="onRemoveMapping(row)">删除</el-button>
            </template>
          </el-table-column>
          <template #empty><div class="empty-state">该指标暂无来源映射</div></template>
        </el-table>
        <div class="alert-info">删除被映射/被使用的指标时提示并禁止删除（建议停用代替删除）。</div>
      </div>
    </div>

    <!-- 指标新增/编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="dialogMode === 'create' ? '新增指标' : '编辑指标'" width="500px" :close-on-click-modal="false">
      <el-form label-width="90px" label-position="left">
        <el-form-item label="指标编码" required>
          <el-input v-model="form.code" maxlength="64" placeholder="如 GDP_YOY（字母/数字/下划线）" />
        </el-form-item>
        <el-form-item label="指标名称" required>
          <el-input v-model="form.name" maxlength="128" placeholder="如 GDP 同比增速" />
        </el-form-item>
        <el-form-item label="分类" required>
          <el-select v-model="form.category" style="width: 100%" allow-create filterable placeholder="选择或输入分类">
            <el-option v-for="c in CATEGORY_OPTIONS" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="单位" required>
          <el-input v-model="form.unit" maxlength="32" placeholder="如 % / 亿美元" />
        </el-form-item>
        <el-form-item label="定义 / 口径">
          <el-input v-model="form.definition" type="textarea" :rows="2" maxlength="512" placeholder="指标计算口径说明（可空）" />
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="form.enabled" active-text="启用" inactive-text="停用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 映射新增/编辑弹窗 -->
    <el-dialog v-model="mappingDialogVisible" :title="mappingMode === 'create' ? '新增映射' : '编辑映射'" width="480px" :close-on-click-modal="false">
      <el-form label-width="90px" label-position="left">
        <el-form-item label="数据源" required>
          <el-input v-model="mappingForm.sourceName" maxlength="128" placeholder="如 世界银行 WDI" />
        </el-form-item>
        <el-form-item label="来源字段" required>
          <el-input v-model="mappingForm.sourceField" maxlength="128" placeholder="如 NY.GDP.MKTP.KD.ZG" />
        </el-form-item>
        <el-form-item label="换算/处理">
          <el-input v-model="mappingForm.transform" maxlength="128" placeholder="如 直接映射 / 百分比转换" />
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="mappingForm.enabled" active-text="启用" inactive-text="停用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="mappingDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="mappingSaving" @click="onSaveMapping">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.panel { background: #fff; border: 1px solid #eef2f7; border-radius: 14px; overflow: hidden; margin-bottom: 16px; }
.panel-head { display: flex; align-items: baseline; justify-content: space-between; padding: 16px 20px 0; }
.panel-head h2 { margin: 0; font-size: 15px; font-weight: 600; color: #0f172a; }
.panel-head .sub { font-size: 12px; color: #94a3b8; flex: 1; margin-left: 8px; }
.panel-body { padding: 16px 20px 20px; }
.filter-panel .toolbar { display: flex; align-items: center; gap: 10px; padding: 16px 20px; }
.search-input { width: 240px; }
.filter-select { width: 140px; }
.spacer { flex: 1; }
.cell-strong { font-weight: 600; color: #1e293b; }
.muted { color: #94a3b8; }
.pager { display: flex; justify-content: flex-end; margin-top: 16px; }
.alert-info { display: flex; align-items: center; gap: 6px; margin-top: 14px; padding: 10px 14px; border-radius: 8px; background: #f4f8ff; color: #5a7aa8; font-size: 12px; }
.empty-state { padding: 32px 0; color: #94a3b8; font-size: 13px; }
</style>
