<script setup lang="ts">
import { computed } from 'vue';
import type { SseSource } from '@/api/search';
import { sourceTypeLabel, type SearchCondState } from './search-meta';

/** 智搜来源面板：条件快照 + 来源卡列表（勾选/联动高亮/存入知识库入口） */

const props = defineProps<{
  /** SSE 流式收集的来源列表 */
  sources: SseSource[];
  /** 当前高亮的来源 idx（与正文角标联动） */
  activeCite: number | null;
  /** 勾选待存库的来源 idx 集合 */
  checkedIdxs: Set<number>;
  /** 「存入知识库」是否可用（检索已完成且有来源） */
  canSaveKb: boolean;
  /** 是否有条件被填入（条件快照展示开关） */
  hasCond: boolean;
  /** 条件快照数据 */
  cond: SearchCondState;
}>();

const emit = defineEmits<{
  'toggle-check': [idx: number];
  /** 点击来源卡 → 父组件联动正文角标 */
  'source-click': [idx: number];
  /** 点击「存入知识库」 */
  'save-kb': [];
}>();

const checkedCount = computed(() => props.checkedIdxs.size);

/** 切换某条来源的勾选态 */
function toggleCheck(idx: number): void {
  emit('toggle-check', idx);
}

/** 点击来源卡 → 联动正文角标高亮 */
function onSourceClick(idx: number): void {
  emit('source-click', idx);
}
</script>

<template>
  <aside class="source-pane">
    <div class="source-head">
      <span>{{ hasCond ? '已回填条件' : '来源与条件' }}</span>
      <span v-if="sources.length" class="source-count">
        {{ checkedCount }}/{{ sources.length }} 条
      </span>
    </div>

    <!-- 存入知识库（M3.4：勾选来源逐条入库待审核） -->
    <el-button
      class="save-kb-btn"
      type="primary"
      plain
      size="small"
      :disabled="!canSaveKb || !checkedCount"
      @click="emit('save-kb')"
    >
      ⬇ 存入知识库（{{ checkedCount }}）
    </el-button>

    <!-- 条件快照 -->
    <div v-if="hasCond" class="cond-snapshot">
      <div v-if="cond.countries.length" class="snap-row">
        <span class="snap-label">国家</span>
        <el-tag v-for="c in cond.countries" :key="c" size="small" type="info">{{ c }}</el-tag>
      </div>
      <div v-if="cond.indicators.length" class="snap-row">
        <span class="snap-label">指标</span>
        <el-tag v-for="c in cond.indicators" :key="c" size="small" type="info">{{ c }}</el-tag>
      </div>
      <div
        v-if="cond.yearFrom != null || cond.yearTo != null"
        class="snap-row"
      >
        <span class="snap-label">年份</span>
        <span class="snap-year">
          {{ cond.yearFrom ?? '…' }} ~ {{ cond.yearTo ?? '…' }}
        </span>
      </div>
    </div>

    <el-empty
      v-if="!sources.length"
      description="检索完成后来源卡将显示在这里"
      :image-size="60"
    />

    <div class="source-list">
      <div
        v-for="s in sources"
        :id="`src-${s.idx}`"
        :key="s.idx"
        class="source-card"
        :class="{ cited: s.isCited, active: activeCite === s.idx }"
        @click="onSourceClick(s.idx)"
      >
        <div class="src-top">
          <el-checkbox
            class="src-check"
            :model-value="checkedIdxs.has(s.idx)"
            @click.stop
            @change="toggleCheck(s.idx)"
          />
          <span class="src-idx">{{ s.idx }}</span>
          <span class="src-type">{{ sourceTypeLabel(s.sourceType) }}</span>
          <span v-if="s.isCited" class="src-cited-badge">引用</span>
        </div>
        <div class="src-title">{{ s.title }}</div>
        <div class="src-snippet">{{ s.snippet }}</div>
        <!-- kb:// 为本地来源的内部去重标识，非真实跳转地址，不渲染为链接 -->
        <a
          v-if="s.url && !s.url.startsWith('kb://')"
          :href="s.url"
          target="_blank"
          rel="noopener"
          class="src-url"
          @click.stop
        >
          {{ s.url }}
        </a>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.source-pane {
  background: #fff;
  border: 1px solid #eef2f7;
  border-radius: 14px;
  padding: 16px;
  max-height: calc(100vh - 200px);
  overflow-y: auto;
}

.source-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  margin-bottom: 12px;
}

.source-count {
  font-weight: 500;
  font-size: 12px;
  color: #94a3b8;
}

.cond-snapshot {
  background: #f8fafc;
  border: 1px solid #eef2f7;
  border-radius: 10px;
  padding: 10px;
  margin-bottom: 14px;
}

.snap-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  color: #475569;
}

.snap-label {
  color: #94a3b8;
  margin-right: 4px;
}

.snap-year {
  color: #2563eb;
  font-weight: 600;
}

.source-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.source-card {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  background: #fff;
  transition: all 0.2s;
}

.source-card:hover {
  border-color: #2563eb;
  box-shadow: 0 2px 10px rgba(37, 99, 235, 0.08);
}

.source-card.cited {
  border-left: 3px solid #2563eb;
}

.source-card.active {
  background: #fef9c3;
  border-color: #fcd34d;
  box-shadow: 0 2px 12px rgba(217, 119, 6, 0.12);
}

.src-top {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.src-idx {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: #2563eb;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.src-type {
  font-size: 11px;
  color: #64748b;
  background: #f1f5f9;
  border-radius: 4px;
  padding: 1px 6px;
}

.src-cited-badge {
  font-size: 11px;
  color: #2563eb;
  background: #e9effd;
  border-radius: 4px;
  padding: 1px 6px;
}

.src-title {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.5;
}

.src-snippet {
  margin-top: 4px;
  font-size: 12px;
  color: #64748b;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.src-url {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: #2563eb;
  text-decoration: none;
  word-break: break-all;
}
</style>
