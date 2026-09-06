<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { listGroups, listLibraries, saveSourcesToKb, type KbGroup, type KbLibrary } from '@/api/kb';
import type { SseSource } from '@/api/search';
import { sourceTypeLabel } from './search-meta';

/** 存入知识库弹窗（M3.4）：勾选来源逐条转为 Markdown 文档，提交后进入管理员审核 */

const props = defineProps<{
  /** 已勾选的来源列表（弹窗内展示） */
  checkedSources: SseSource[];
  /** 已勾选的来源 idx 集合（提交入参） */
  checkedIdxs: Set<number>;
  /** 本次检索会话 id（未完成检索时为 null） */
  sessionId: string | null;
}>();

const visible = ref(false);
const saving = ref(false);
const saveForm = reactive({
  libraryId: '',
  groupId: '',
  visibility: 'PRIVATE',
  tags: '',
});
const kbLibs = ref<KbLibrary[]>([]);
const kbGroups = ref<KbGroup[]>([]);

const checkedCount = computed(() => props.checkedSources.length);

/** 打开弹窗：校验后加载知识库列表并回填默认值 */
async function open(): Promise<void> {
  if (!props.sessionId) {
    ElMessage.warning('请先完成一次智搜');
    return;
  }
  if (!checkedCount.value) {
    ElMessage.warning('请先在右侧来源面板勾选要存入知识库的来源');
    return;
  }
  try {
    if (!kbLibs.value.length) kbLibs.value = await listLibraries();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '知识库列表加载失败');
    return;
  }
  saveForm.groupId = '';
  saveForm.tags = '';
  saveForm.libraryId = kbLibs.value.length === 1 ? kbLibs.value[0].id : '';
  visible.value = true;
}

/** 弹窗内切换目标库 → 联动加载分组 */
async function onSaveLibChange(): Promise<void> {
  saveForm.groupId = '';
  kbGroups.value = saveForm.libraryId ? await listGroups(saveForm.libraryId) : [];
}

async function submitSaveKb(): Promise<void> {
  if (!saveForm.libraryId) {
    ElMessage.warning('请选择目标知识库');
    return;
  }
  if (!props.sessionId) return;
  saving.value = true;
  try {
    const tags = saveForm.tags
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean);
    const r = await saveSourcesToKb(props.sessionId, {
      idxs: [...props.checkedIdxs],
      libraryId: saveForm.libraryId,
      groupId: saveForm.groupId || null,
      visibility: saveForm.visibility,
      tags,
    });
    visible.value = false;
    ElMessage.success(`已提交管理员审核（${r.created} 条来源），审核通过后自动学习入库`);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '存入失败');
  } finally {
    saving.value = false;
  }
}

defineExpose({ open });
</script>

<template>
  <el-dialog v-model="visible" title="存入知识库" width="480px">
    <div class="save-hint">
      将右侧勾选的 <b>{{ checkedCount }}</b> 条来源逐条转为 Markdown 文档，
      提交后进入管理员审核，审核通过后自动学习入库并参与本地检索。
    </div>
    <div class="field">
      <label>目标知识库</label>
      <el-select
        v-model="saveForm.libraryId"
        placeholder="选择知识库"
        style="width: 100%"
        @change="onSaveLibChange"
      >
        <el-option v-for="lib in kbLibs" :key="lib.id" :label="lib.name" :value="lib.id" />
      </el-select>
    </div>
    <div class="field">
      <label>目标分组（可选）</label>
      <el-select
        v-model="saveForm.groupId"
        placeholder="不指定分组"
        clearable
        style="width: 100%"
        :disabled="!saveForm.libraryId"
      >
        <el-option v-for="g in kbGroups" :key="g.id" :label="g.name" :value="g.id" />
      </el-select>
    </div>
    <div class="field">
      <label>可见性</label>
      <el-radio-group v-model="saveForm.visibility">
        <el-radio value="PRIVATE">私有</el-radio>
        <el-radio value="PUBLIC">公共</el-radio>
      </el-radio-group>
    </div>
    <div class="field">
      <label>标签（可选，逗号分隔）</label>
      <el-input v-model="saveForm.tags" placeholder="如：宏观经济, GDP" maxlength="80" />
    </div>
    <div class="field">
      <label>本次勾选来源（{{ checkedCount }} 条，每个来源将独立存入知识库并切片）</label>
      <div class="src-save-list">
        <div v-for="s in checkedSources" :key="s.idx" class="src-save-item">
          <div class="ssi-top">
            <span class="ssi-name">{{ s.title }}</span>
            <span class="ssi-type">{{ sourceTypeLabel(s.sourceType) }}</span>
          </div>
          <div v-if="s.url && !s.url.startsWith('kb://')" class="ssi-url">{{ s.url }}</div>
        </div>
      </div>
    </div>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submitSaveKb">
        提交审核（{{ checkedCount }} 条）
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.save-hint {
  padding: 10px 14px;
  border-radius: 10px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  color: #1d4ed8;
  font-size: 12.5px;
  line-height: 1.7;
  margin-bottom: 16px;
}

.field {
  margin-bottom: 14px;
}

.field label {
  display: block;
  font-size: 12.5px;
  color: #64748b;
  margin-bottom: 6px;
}

.src-save-list {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid #eef2f7;
  border-radius: 10px;
  background: #f8fafc;
}

.src-save-item {
  padding: 8px 12px;
  border-bottom: 1px solid #f1f5f9;
}

.src-save-item:last-child {
  border-bottom: none;
}

.ssi-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ssi-name {
  font-size: 13px;
  color: #1e293b;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ssi-type {
  flex-shrink: 0;
  font-size: 11px;
  color: #2563eb;
  background: #e9effd;
  border-radius: 4px;
  padding: 1px 6px;
}

.ssi-url {
  margin-top: 3px;
  font-size: 11.5px;
  color: #94a3b8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
