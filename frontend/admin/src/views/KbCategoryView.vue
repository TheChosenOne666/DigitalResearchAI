<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import PageHead from '@/components/PageHead.vue';
import { ApiError } from '@/api/http';
import { fetchKbCategories, createKbCategory, updateKbCategory, setKbCategoryEnabled, fetchKbTags, createKbTag, updateKbTag, setKbTagEnabled } from '@/api/admin';
import type { KbCategoryRow, KbTagRow } from '@/api/admin';

const loading = ref(false);
const categories = ref<KbCategoryRow[]>([]);
const tags = ref<KbTagRow[]>([]);

async function load() {
  loading.value = true;
  try {
    const [cats, tgs] = await Promise.all([fetchKbCategories(), fetchKbTags()]);
    categories.value = cats;
    tags.value = tgs;
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '加载失败');
  } finally {
    loading.value = false;
  }
}

/** 平铺分类按树序展示（父在前，子缩进） */
const categoryRows = computed(() => {
  const rows: Array<KbCategoryRow & { indent: number }> = [];
  const byParent = new Map<string | null, KbCategoryRow[]>();
  for (const c of [...categories.value].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))) {
    const list = byParent.get(c.parentId) ?? [];
    list.push(c);
    byParent.set(c.parentId, list);
  }
  const walk = (parentId: string | null, depth: number) => {
    for (const c of byParent.get(parentId) ?? []) {
      rows.push({ ...c, indent: depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
});

// ===== 分类编辑 =====
const catDialog = ref(false);
const catSaving = ref(false);
const catForm = ref<{ id: string | null; name: string; parentId: string | null; sort: number }>({ id: null, name: '', parentId: null, sort: 0 });

function openCategory(row?: KbCategoryRow, parentId?: string) {
  catForm.value = row
    ? { id: row.id, name: row.name, parentId: row.parentId, sort: row.sort }
    : { id: null, name: '', parentId: parentId ?? null, sort: 0 };
  catDialog.value = true;
}

async function saveCategory() {
  if (catForm.value.name.trim().length === 0) {
    ElMessage.warning('请填写分类名');
    return;
  }
  catSaving.value = true;
  try {
    if (catForm.value.id) {
      await updateKbCategory(catForm.value.id, { name: catForm.value.name.trim(), sort: catForm.value.sort });
      ElMessage.success('分类已更新');
    } else {
      await createKbCategory({ name: catForm.value.name.trim(), parentId: catForm.value.parentId ?? undefined, sort: catForm.value.sort });
      ElMessage.success('分类已新增');
    }
    catDialog.value = false;
    void load();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '保存失败');
  } finally {
    catSaving.value = false;
  }
}

async function toggleCategory(row: KbCategoryRow) {
  try {
    await setKbCategoryEnabled(row.id, !row.enabled);
    ElMessage.success(`分类已${row.enabled ? '停用' : '启用'}`);
    void load();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '操作失败');
  }
}

// ===== 标签编辑 =====
const tagDialog = ref(false);
const tagSaving = ref(false);
const tagForm = ref<{ id: string | null; name: string }>({ id: null, name: '' });

function openTag(row?: KbTagRow) {
  tagForm.value = row ? { id: row.id, name: row.name } : { id: null, name: '' };
  tagDialog.value = true;
}

async function saveTag() {
  if (tagForm.value.name.trim().length === 0) {
    ElMessage.warning('请填写标签名');
    return;
  }
  tagSaving.value = true;
  try {
    if (tagForm.value.id) {
      await updateKbTag(tagForm.value.id, { name: tagForm.value.name.trim() });
      ElMessage.success('标签已更新');
    } else {
      await createKbTag(tagForm.value.name.trim());
      ElMessage.success('标签已新增');
    }
    tagDialog.value = false;
    void load();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '保存失败');
  } finally {
    tagSaving.value = false;
  }
}

async function toggleTag(row: KbTagRow) {
  try {
    await setKbTagEnabled(row.id, !row.enabled);
    ElMessage.success(`标签已${row.enabled ? '停用' : '启用'}`);
    void load();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '操作失败');
  }
}

onMounted(() => void load());
</script>

<template>
  <div class="kb-category-page">
    <PageHead title="知识分类配置" desc="管理知识库分类、标签体系（PRD A-17）" :tags="['分类', '标签', '层级配置']" />

    <div class="grid">
      <div class="panel">
        <div class="panel-head">
          <h2>分类层级</h2>
          <span class="sub">多级层级 · 上限 3 级</span>
          <span class="spacer"></span>
          <el-button size="small" type="primary" @click="openCategory()">新增分类</el-button>
        </div>
        <div class="panel-body">
          <el-table v-loading="loading" :data="categoryRows" style="width: 100%" row-key="id">
            <el-table-column label="层级" width="70">
              <template #default="{ row }">{{ row.level }} 级</template>
            </el-table-column>
            <el-table-column label="分类名称" min-width="200">
              <template #default="{ row }">
                <span :style="{ paddingLeft: row.indent * 20 + 'px' }">
                  <span v-if="row.indent > 0" class="branch">└&nbsp;</span>
                  <span class="cell-strong">{{ row.name }}</span>
                  <el-tag v-if="!row.enabled" type="info" effect="light" size="small" class="ml8">已停用</el-tag>
                </span>
              </template>
            </el-table-column>
            <el-table-column label="排序" width="70">
              <template #default="{ row }">{{ row.sort }}</template>
            </el-table-column>
            <el-table-column label="操作" width="160" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openCategory(row)">编辑</el-button>
                <el-button v-if="row.level < 3" link type="primary" @click="openCategory(undefined, row.id)">子级</el-button>
                <el-button link :type="row.enabled ? 'danger' : 'success'" @click="toggleCategory(row)">{{ row.enabled ? '停用' : '启用' }}</el-button>
              </template>
            </el-table-column>
            <template #empty><div class="empty-state">暂无分类，点击「新增分类」创建</div></template>
          </el-table>
          <div class="note">停用分类/标签不影响已关联历史条目检索；含子级的分类不可删除，可先停用。</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2>标签管理</h2>
          <span class="sub">标签体系维护</span>
          <span class="spacer"></span>
          <el-button size="small" type="primary" @click="openTag()">新增标签</el-button>
        </div>
        <div class="panel-body">
          <div v-if="tags.length" class="tag-cloud">
            <span v-for="t in tags" :key="t.id" class="tag" :class="{ disabled: !t.enabled }">
              {{ t.name }}<i v-if="t.useCount > 0" class="use">·{{ t.useCount }}</i>
            </span>
          </div>
          <el-table v-loading="loading" :data="tags" style="width: 100%">
            <el-table-column label="标签" min-width="120">
              <template #default="{ row }"><span class="cell-strong">{{ row.name }}</span></template>
            </el-table-column>
            <el-table-column label="使用条目数" width="110">
              <template #default="{ row }">{{ row.useCount }}</template>
            </el-table-column>
            <el-table-column label="操作" width="130" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openTag(row)">编辑</el-button>
                <el-button link :type="row.enabled ? 'danger' : 'success'" @click="toggleTag(row)">{{ row.enabled ? '停用' : '启用' }}</el-button>
              </template>
            </el-table-column>
            <template #empty><div class="empty-state">暂无标签</div></template>
          </el-table>
          <div class="note">用户端知识库可按分类/标签筛选（U-10/U-13）。</div>
        </div>
      </div>
    </div>

    <el-dialog v-model="catDialog" :title="catForm.id ? '编辑分类' : catForm.parentId ? '新增子级分类' : '新增分类'" width="420px">
      <el-form label-width="80px">
        <el-form-item label="上级分类">
          <el-input :model-value="catForm.parentId ? (categoryRows.find((c) => c.id === catForm.parentId)?.name ?? catForm.parentId) : '（一级分类）'" disabled />
        </el-form-item>
        <el-form-item label="分类名称">
          <el-input v-model="catForm.name" placeholder="如：国内经济" maxlength="64" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="catForm.sort" :min="0" :max="999" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="catDialog = false">取消</el-button>
        <el-button type="primary" :loading="catSaving" @click="saveCategory">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="tagDialog" :title="tagForm.id ? '编辑标签' : '新增标签'" width="420px">
      <el-form label-width="80px">
        <el-form-item label="标签名">
          <el-input v-model="tagForm.name" placeholder="如：GDP" maxlength="32" @keyup.enter="saveTag" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="tagDialog = false">取消</el-button>
        <el-button type="primary" :loading="tagSaving" @click="saveTag">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: 3fr 2fr; gap: 16px; align-items: start; }
.panel { background: #fff; border: 1px solid #eef2f7; border-radius: 14px; overflow: hidden; margin-bottom: 16px; }
.panel-head { display: flex; align-items: center; gap: 10px; padding: 14px 20px 0; }
.panel-head h2 { font-size: 15px; font-weight: 600; color: #1e293b; margin: 0; }
.panel-head .sub { font-size: 12px; color: #94a3b8; }
.spacer { flex: 1; }
.panel-body { padding: 14px 20px 20px; }
.cell-strong { font-weight: 600; color: #1e293b; }
.branch { color: #94a3b8; }
.ml8 { margin-left: 8px; }
.note { margin-top: 12px; font-size: 12px; color: #94a3b8; }
.tag-cloud { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.tag { padding: 4px 12px; border-radius: 999px; font-size: 12.5px; background: #ecf5ff; color: #409eff; }
.tag .use { font-style: normal; opacity: 0.7; margin-left: 2px; }
.tag.disabled { background: #f1f5f9; color: #94a3b8; text-decoration: line-through; }
.empty-state { padding: 32px 0; color: #94a3b8; font-size: 13px; }
</style>
