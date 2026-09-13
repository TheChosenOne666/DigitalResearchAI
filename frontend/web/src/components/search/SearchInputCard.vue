<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { uploadSearchFiles, type SearchMode, type SearchUploadItem } from '@/api/search';
import type { SearchCondState } from './search-meta';
import { COUNTRY_OPTIONS, INDICATOR_OPTIONS } from './search-meta';

/** 智搜输入卡（对齐原型 ss-box）：输入行 + 筛选行；检索/中止动作通过事件交父组件编排 */

/** 模式选项 */
const MODES: Array<{ value: SearchMode; label: string }> = [
  { value: 'hybrid', label: '混合' },
  { value: 'web', label: '联网' },
  { value: 'local', label: '知识库' },
];

defineProps<{ /** 检索进行中（按钮切换为「停止」） */ running: boolean }>();

const question = defineModel<string>('question', { required: true });
const mode = defineModel<SearchMode>('mode', { required: true });
const conditionsFilled = defineModel<boolean>('conditionsFilled', { required: true });
const cond = defineModel<SearchCondState>('cond', { required: true });
/** 18 批 3：本次检索附带的本地资料 id（上传成功后回填父组件） */
const uploadIds = defineModel<string[]>('uploadIds', { required: true });

const emit = defineEmits<{
  /** 发起检索（问题为空时此处拦截） */
  search: [];
  /** 中止当前检索 */
  stop: [];
}>();

function startSearch(): void {
  if (!question.value.trim()) {
    ElMessage.warning('请先输入要研究的问题');
    return;
  }
  emit('search');
}

function stopSearch(): void {
  emit('stop');
}

// ===== 18 批 3：本地资料上传（作为本次检索的额外来源，不自动入知识库）=====

/** 单次累计最多文件数（与后端 MAX_UPLOAD_FILES 一致） */
const MAX_FILES = 5;
/** 单文件大小上限 MB（与后端 MAX_UPLOAD_BYTES 一致） */
const MAX_UPLOAD_MB = 20;
/** 允许的扩展名（与后端白名单一致） */
const ACCEPT_EXT = '.xlsx,.xls,.csv,.docx,.doc,.pdf,.txt,.md';

/** 已成功解析的资料（失败项只提示不入列） */
const files = ref<SearchUploadItem[]>([]);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

/** 「+」→ 打开文件选择 */
function onUpload(): void {
  fileInput.value?.click();
}

/** 文件选择/拖拽统一入口：校验数量 → 上传解析 → 回填 uploadIds */
async function addFiles(picked: File[]): Promise<void> {
  if (!picked.length || uploading.value) return;
  const remain = MAX_FILES - files.value.length;
  if (remain <= 0) {
    ElMessage.warning(`最多添加 ${MAX_FILES} 个文件`);
    return;
  }
  if (picked.length > remain) {
    ElMessage.warning(`最多 ${MAX_FILES} 个文件，已忽略多余的 ${picked.length - remain} 个`);
  }
  const candidate = picked.slice(0, remain);
  // 大小预校验：避免把超限文件白传上去（后端仍会独立校验，此处只是省一次往返）
  const limitBytes = MAX_UPLOAD_MB * 1024 * 1024;
  const tooBig = candidate.filter((f) => f.size > limitBytes);
  if (tooBig.length) {
    ElMessage.error(`${tooBig.map((f) => f.name).join('、')} 超过 ${MAX_UPLOAD_MB}MB 上限，已跳过`);
  }
  const valid = candidate.filter((f) => f.size > 0 && f.size <= limitBytes);
  if (!valid.length) return;
  uploading.value = true;
  try {
    const results = await uploadSearchFiles(valid);
    for (const r of results) {
      if (r.status === 'parsed' && r.id) {
        files.value.push(r);
      } else {
        ElMessage.error(`${r.name}：${r.error ?? '解析失败'}`);
      }
    }
    uploadIds.value = files.value.map((f) => f.id!).filter(Boolean);
    if (results.some((r) => r.status === 'parsed')) {
      ElMessage.success(`已添加 ${results.filter((r) => r.status === 'parsed').length} 份本地资料，将作为本次检索的来源`);
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '上传失败');
  } finally {
    uploading.value = false;
  }
}

/** 文件选择框变化 */
function onFilesPicked(e: Event): void {
  const input = e.target as HTMLInputElement;
  void addFiles([...(input.files ?? [])]);
  input.value = ''; // 允许重复选择同一文件
}

/** 拖拽放入 */
function onDrop(e: DragEvent): void {
  void addFiles([...(e.dataTransfer?.files ?? [])]);
}

/** 移除一份资料（同步回填 uploadIds） */
function removeFile(id?: string): void {
  if (!id) return;
  files.value = files.value.filter((f) => f.id !== id);
  uploadIds.value = files.value.map((f) => f.id!).filter(Boolean);
}

/** 人类可读的文件大小 */
function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 一键清空 4 项筛选条件 */
function resetCond(): void {
  cond.value.countries = [];
  cond.value.indicators = [];
  cond.value.yearFrom = null;
  cond.value.yearTo = null;
  conditionsFilled.value = false;
}
</script>

<template>
  <section class="query-card" @dragover.prevent @drop.prevent="onDrop">
    <div class="ss-box-row">
      <button
        class="ss-plus"
        :class="{ busy: uploading }"
        :disabled="uploading"
        title="上传本地资料作为本次检索来源（Excel / CSV / Word / PDF / 文本；单次最多 5 个，单个 ≤ 20MB）"
        @click="onUpload"
      >
        {{ uploading ? '…' : '+' }}
      </button>
      <!-- 18 批 3：本地资料文件选择（隐藏，由「+」触发；也支持拖拽到卡片） -->
      <input
        ref="fileInput"
        class="ss-file"
        type="file"
        multiple
        :accept="ACCEPT_EXT"
        @change="onFilesPicked"
      />
      <input
        class="ss-input"
        v-model="question"
        placeholder="询问任何问题…"
        @keydown.enter="startSearch"
      />
      <button
        class="ss-send"
        :class="{ stop: running }"
        @click="running ? stopSearch() : startSearch()"
      >
        <svg class="send-ic" viewBox="0 0 24 24" fill="none">
          <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" />
          <path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
        {{ running ? '停止' : '搜索' }}
      </button>
    </div>

    <!-- 18 批 3：已添加的本地资料（作为本次检索来源，与检索结果一并进入选择态） -->
    <div v-if="files.length" class="ss-uploads">
      <span class="ss-uploads-label">本地资料</span>
      <span
        v-for="f in files"
        :key="f.id"
        class="ss-up-chip"
        :title="`${f.name} · ${sizeText(f.size)}`"
      >
        <span class="ss-up-name">{{ f.name }}</span>
        <small class="ss-up-size">{{ sizeText(f.size) }}</small>
        <button class="ss-up-x" title="移除该资料" @click="removeFile(f.id)">×</button>
      </span>
    </div>

    <div class="ss-conds">
      <el-select v-model="mode" class="ss-mode-sel">
        <el-option v-for="m in MODES" :key="m.value" :label="m.label" :value="m.value" />
      </el-select>
      <el-select
        v-model="cond.countries"
        class="ss-cond"
        :class="{ 'has-val': cond.countries.length }"
        multiple
        filterable
        allow-create
        default-first-option
        collapse-tags
        placeholder="国家 / 地区"
        title="国家 / 地区（AI 自动识别，可手动修改）"
      >
        <el-option v-for="c in COUNTRY_OPTIONS" :key="c" :label="c" :value="c" />
      </el-select>
      <el-select
        v-model="cond.indicators"
        class="ss-cond"
        :class="{ 'has-val': cond.indicators.length }"
        multiple
        filterable
        allow-create
        default-first-option
        collapse-tags
        placeholder="统计指标"
        title="统计指标（AI 自动识别，可手动修改）"
      >
        <el-option v-for="i in INDICATOR_OPTIONS" :key="i" :label="i" :value="i" />
      </el-select>
      <el-input-number
        v-model="cond.yearFrom"
        class="ss-cond ss-year"
        :class="{ 'has-val': cond.yearFrom != null }"
        :min="1900"
        :max="2100"
        :controls="false"
        placeholder="开始年份"
        title="开始年份（AI 自动识别，可手动修改）"
      />
      <el-input-number
        v-model="cond.yearTo"
        class="ss-cond ss-year"
        :class="{ 'has-val': cond.yearTo != null }"
        :min="1900"
        :max="2100"
        :controls="false"
        placeholder="结束年份"
        title="结束年份（AI 自动识别，可手动修改）"
      />
      <button class="ss-reset" title="重置 4 项筛选条件" @click="resetCond">
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M4 4v6h6M20 20v-6h-6M5.6 9A7 7 0 0 1 18 7M18.4 15A7 7 0 0 1 6 17"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <span v-if="conditionsFilled" class="filled-tip">AI 已回填，可手动微调</span>
    </div>
  </section>
</template>

<style scoped>
.query-card {
  width: min(960px, 100%);
  padding: 12px;
  border: 1px solid #cbd5e1;
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 12px 34px rgba(15, 23, 42, 0.08);
  transition: border-color 0.15s, box-shadow 0.15s;
}

.query-card:focus-within {
  border-color: #2563eb;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.12), 0 12px 34px rgba(15, 23, 42, 0.1);
}

.ss-box-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ===== 18 批 3：本地资料上传 ===== */
.ss-file {
  display: none;
}

.ss-plus.busy {
  cursor: progress;
  opacity: 0.7;
}

.ss-uploads {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 8px 2px 0;
}

.ss-uploads-label {
  font-size: 12px;
  color: #64748b;
}

.ss-up-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 280px;
  padding: 2px 4px 2px 10px;
  border: 1px solid #dbeafe;
  border-radius: 999px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 12px;
}

.ss-up-name {
  max-width: 170px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ss-up-size {
  color: #64748b;
  font-size: 11px;
}

.ss-up-x {
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #64748b;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.ss-up-x:hover {
  background: #dbeafe;
  color: #1d4ed8;
}

.ss-plus {
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  border: 0;
  border-radius: 12px;
  background: #e7f0ff;
  color: #2563eb;
  font-size: 22px;
  font-weight: 700;
  cursor: pointer;
}

.ss-plus:hover {
  background: #dbeafe;
}

.ss-input {
  flex: 1;
  min-width: 0;
  height: 44px;
  padding: 0 6px;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 15px;
  color: #0f172a;
}

.ss-input::placeholder {
  color: #94a3b8;
}

.ss-send {
  height: 44px;
  flex: 0 0 auto;
  padding: 0 20px;
  border: 0;
  border-radius: 12px;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.ss-send:hover {
  filter: brightness(1.06);
}

.ss-send.stop {
  background: linear-gradient(135deg, #dc2626, #b91c1c);
}

.send-ic {
  width: 15px;
  height: 15px;
}

/* ---- 筛选行 ---- */

.ss-conds {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 0 0;
  flex-wrap: wrap;
}

.ss-mode-sel {
  flex: 0 0 auto;
  width: 110px;
}

.ss-cond {
  flex: 1 1 0;
  min-width: 0;
}

.ss-year {
  flex: 0 0 auto;
  width: 120px;
}

.ss-conds :deep(.el-select__wrapper) {
  min-height: 36px;
  border-radius: 10px;
}

.ss-cond.has-val :deep(.el-select__wrapper) {
  background: #fff;
  border-color: #2563eb;
}

.ss-reset {
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  background: #f8fafc;
  color: #64748b;
  cursor: pointer;
}

.ss-reset svg {
  width: 16px;
  height: 16px;
}

.ss-reset:hover {
  border-color: #2563eb;
  color: #2563eb;
  background: #eff6ff;
}

.filled-tip {
  font-size: 12px;
  color: #2563eb;
  white-space: nowrap;
}
</style>
