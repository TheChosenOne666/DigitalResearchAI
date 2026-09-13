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
  /** 结构化错误明细（多条，逐行展示；为空时回落到 error 单条） */
  errorDetails?: string[];
  /** 是否可「继续生成」（生成失败且存在可续跑任务时为 true） */
  canResume?: boolean;
  /** 续跑请求进行中（禁用按钮防重复点击） */
  resuming?: boolean;
  /** 报告 Markdown 文本（流式追加） */
  reportText: string;
  /** 当前高亮的引用角标 */
  activeCite: number | null;
  /** 来源总数（过滤 LLM 幻觉引文编号） */
  maxCite?: number;
}>();

const emit = defineEmits<{
  /** 点击正文角标 → 父组件联动来源卡高亮 */
  'cite-click': [idx: number];
  /** 点击「继续生成」→ 父组件发起断点续跑 */
  resume: [];
}>();

/** 技术痕迹清洗：兜底移除原始报错尾巴（Request id / status / JSON 错误体），避免泄漏给用户 */
function sanitize(text: string): string {
  return text
    .replace(/\s*Request id:[\s\S]*$/i, '')
    .replace(/\s*\|\s*status=\d+[\s\S]*$/i, '')
    .replace(/\s*\|\s*\{[\s\S]*$/i, '')
    .replace(/\s*status=\d+[\s\S]*$/i, '')
    .trim();
}

/**
 * 失败提示行（面向用户）：
 * 1) 清洗技术痕迹；2) 合并「同一原因」的多章失败为一条，避免逐行重复；
 * 3) 结构化明细优先，无则回落单条 error。
 */
const errorLines = computed<string[]>(() => {
  const raw = (props.errorDetails ?? []).map((s) => sanitize(s.trim())).filter(Boolean);
  const list = raw.length ? raw : props.error.trim() ? [sanitize(props.error.trim())] : [];

  // 合并同因失败：把「本章「X」…」「本章「Y」…」按后缀原因归类
  const grouped = new Map<string, string[]>();
  for (const line of list) {
    const m = /^本章「([^」]+)」(.+)$/.exec(line);
    if (m) {
      const [, heading, reason] = m;
      const arr = grouped.get(reason) ?? [];
      arr.push(heading);
      grouped.set(reason, arr);
    } else {
      const arr = grouped.get(line) ?? [];
      grouped.set(line, arr);
    }
  }
  return [...grouped.entries()].map(([reason, headings]) =>
    headings.length ? `${headings.join('、')}：${reason}` : reason,
  );
});

/** 当前阶段序号；done 视为全部完成（返回 STAGES.length，使全部节点进入 done 态、无 active） */
const stageIndex = computed(() =>
  props.stage === 'done'
    ? STAGES.length
    : Math.max(0, STAGES.findIndex((s) => s.key === props.stage)),
);
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

    <!-- 失败提示：逐条换行 + 内联「继续生成」重试入口（无需打开任务中心） -->
    <div v-if="errorLines.length" class="err-box" role="alert">
      <div class="err-main">
        <i class="err-ic" aria-hidden="true">!</i>
        <div class="err-lines">
          <p v-for="(line, i) in errorLines" :key="i" class="err-line">{{ line }}</p>
        </div>
      </div>
      <button
        v-if="canResume"
        class="err-resume"
        :disabled="resuming"
        @click="emit('resume')"
      >
        {{ resuming ? '继续生成中…' : '继续生成' }}
      </button>
    </div>

    <div class="report-body-wrap" v-loading="isGenerating">
      <MarkdownView
        v-if="reportText"
        :content="reportText"
        :active-cite="activeCite"
        :max-cite="maxCite"
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

/* ---- 失败提示（逐条换行 + 内联重试） ---- */

.err-box {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 16px;
  padding: 12px 14px;
  border: 1px solid #fecaca;
  border-radius: 10px;
  background: #fef2f2;
}

.err-main {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  flex: 1;
  min-width: 0;
}

.err-ic {
  flex: 0 0 auto;
  display: grid;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  place-items: center;
  border-radius: 50%;
  background: #dc2626;
  color: #fff;
  font-size: 12px;
  font-style: normal;
  font-weight: 700;
  line-height: 1;
}

.err-lines {
  min-width: 0;
}

.err-line {
  margin: 0;
  color: #b91c1c;
  font-size: 13px;
  line-height: 1.7;
  word-break: break-word;
}

.err-line + .err-line {
  margin-top: 2px;
}

.err-resume {
  flex: 0 0 auto;
  height: 32px;
  padding: 0 16px;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.err-resume:hover:not(:disabled) {
  filter: brightness(1.06);
}

.err-resume:disabled {
  background: #93b4f5;
  cursor: progress;
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
