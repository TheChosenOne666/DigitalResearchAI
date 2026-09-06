<script setup lang="ts">
import { computed } from 'vue';
import MarkdownView from '@/components/MarkdownView.vue';
import type { SearchStage } from '@/api/search';

/** 智搜报告面板：5 阶段进度条 + 错误提示 + Markdown 报告正文（打字光标） */

/** 阶段顺序（5 阶段动画） */
const STAGES: Array<{ key: SearchStage; label: string }> = [
  { key: 'intent', label: '理解意图' },
  { key: 'searching', label: '检索' },
  { key: 'fusing', label: '融合' },
  { key: 'generating', label: '生成报告' },
  { key: 'done', label: '完成' },
];

const props = defineProps<{
  /** 当前 SSE 阶段 */
  stage: SearchStage;
  /** 检索是否进行中 */
  running: boolean;
  /** 错误信息（空串 = 无错误） */
  error: string;
  /** 报告 Markdown 文本（流式追加） */
  reportText: string;
  /** 当前高亮的引用角标 */
  activeCite: number | null;
}>();

const emit = defineEmits<{
  /** 点击正文角标 → 父组件联动来源卡高亮 */
  'cite-click': [idx: number];
}>();

/** 当前阶段序号 */
const stageIndex = computed(() => Math.max(0, STAGES.findIndex((s) => s.key === props.stage)));
const isGenerating = computed(() => props.stage === 'generating' && props.running);
</script>

<template>
  <div class="report-pane">
    <!-- 5 阶段进度 -->
    <div class="stepper" aria-label="进度">
      <template v-for="(s, i) in STAGES" :key="s.key">
        <div class="step" :class="{ done: i < stageIndex, active: i === stageIndex }">
          <span class="step-dot" />
          <span class="step-label">{{ s.label }}</span>
        </div>
        <div
          v-if="i < STAGES.length - 1"
          class="step-line"
          :class="{ filled: i < stageIndex }"
        />
      </template>
    </div>

    <el-alert
      v-if="error"
      :title="error"
      type="error"
      show-icon
      :closable="false"
      class="err-alert"
    />

    <div class="report-body-wrap" v-loading="isGenerating">
      <MarkdownView
        v-if="reportText"
        :content="reportText"
        :active-cite="activeCite"
        @cite-click="emit('cite-click', $event)"
      />
      <div v-else class="report-empty">
        {{ isGenerating ? '正在生成分析报告…' : '等待生成…' }}
      </div>
      <span v-if="isGenerating" class="caret" />
    </div>
  </div>
</template>

<style scoped>
.report-pane {
  background: #fff;
  border: 1px solid #eef2f7;
  border-radius: 14px;
  padding: 20px 24px;
  min-height: 320px;
}

.stepper {
  display: flex;
  align-items: center;
  margin-bottom: 20px;
}

.step {
  display: flex;
  align-items: center;
  gap: 6px;
}

.step-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid #d3dffa;
  background: #fff;
}

.step.done .step-dot {
  background: #2563eb;
  border-color: #2563eb;
}

.step.active .step-dot {
  border-color: #2563eb;
  box-shadow: 0 0 0 4px #d3e0fb;
  animation: pulse 1.2s infinite;
}

@keyframes pulse {
  0%,
  100% {
    box-shadow: 0 0 0 4px #d3e0fb;
  }
  50% {
    box-shadow: 0 0 0 7px #dbeafe;
  }
}

.step-label {
  font-size: 13px;
  color: #64748b;
}

.step.done .step-label,
.step.active .step-label {
  color: #2563eb;
  font-weight: 600;
}

.step-line {
  flex: 1;
  height: 2px;
  margin: 0 10px;
  background: #e2e8f0;
}

.step-line.filled {
  background: #2563eb;
}

.err-alert {
  margin-bottom: 16px;
}

.report-body-wrap {
  position: relative;
  min-height: 120px;
}

.report-empty {
  color: #94a3b8;
  font-size: 14px;
  padding: 40px 0;
  text-align: center;
}

.caret {
  display: inline-block;
  width: 8px;
  height: 18px;
  margin-left: 2px;
  background: #2563eb;
  vertical-align: text-bottom;
  animation: blink 0.8s steps(1) infinite;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}
</style>
