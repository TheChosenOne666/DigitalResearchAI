<script setup lang="ts">
import { ElMessage } from 'element-plus';
import type { SearchMode } from '@/api/search';
import type { SearchCondState } from './search-meta';

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

/** 「+」上传入口（M4 数据源接入实现，暂占位） */
function onUpload(): void {
  ElMessage.info('外部数据上传（Excel/CSV）将在数据源接入中提供');
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
  <section class="query-card">
    <div class="ss-box-row">
      <button class="ss-plus" title="上传 / 接入外部数据（Excel、CSV）" @click="onUpload">+</button>
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
