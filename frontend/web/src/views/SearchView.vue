<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import MarkdownView from '@/components/MarkdownView.vue';
import { useSessionStore } from '@/stores/session';
import {
  fetchHistories,
  fetchReportDetail,
  searchStream,
  type SearchConditions,
  type SearchMode,
  type SearchStage,
  type SessionListItem,
  type SseSource,
} from '@/api/search';

const router = useRouter();
const session = useSessionStore();

/** 阶段顺序（5 阶段动画） */
const STAGES: Array<{ key: SearchStage; label: string }> = [
  { key: 'intent', label: '理解意图' },
  { key: 'searching', label: '检索' },
  { key: 'fusing', label: '融合' },
  { key: 'generating', label: '生成报告' },
  { key: 'done', label: '完成' },
];

/** 模式选项 */
const MODES: Array<{ value: SearchMode; label: string }> = [
  { value: 'hybrid', label: '混合' },
  { value: 'web', label: '联网' },
  { value: 'local', label: '知识库' },
];

const question = ref('');
const mode = ref<SearchMode>('hybrid');
const submittedQuestion = ref('');

/** 检索条件（AI 回填 has-val 状态，可手动微调） */
const cond = reactive<{
  countries: string[];
  indicators: string[];
  yearFrom: number | null;
  yearTo: number | null;
}>({ countries: [], indicators: [], yearFrom: null, yearTo: null });
const conditionsFilled = ref(false);

/** 运行/阶段/结果状态 */
const running = ref(false);
const stage = ref<SearchStage>('intent');
const showResult = ref(false);
const reportText = ref('');
const sources = ref<SseSource[]>([]);
const activeCite = ref<number | null>(null);
const errorMsg = ref('');
const doneInfo = ref<{ sessionId: string; reportId: string } | null>(null);

const abortCtrl = ref<AbortController | null>(null);

/** 当前阶段序号 */
const stageIndex = computed(
  () => Math.max(0, STAGES.findIndex((s) => s.key === stage.value)),
);
const isGenerating = computed(() => stage.value === 'generating' && running.value);

/** 是否有条件被填入（has-val 深色态） */
const hasCond = computed(
  () =>
    cond.countries.length > 0 ||
    cond.indicators.length > 0 ||
    cond.yearFrom != null ||
    cond.yearTo != null,
);

/** 来源卡类型徽标文案 */
function sourceTypeLabel(t: SseSource['sourceType']): string {
  return t === 'vertical' ? '垂直数据' : t === 'web' ? '联网' : '知识库';
}

function resetResult(): void {
  reportText.value = '';
  sources.value = [];
  errorMsg.value = '';
  doneInfo.value = null;
  activeCite.value = null;
  conditionsFilled.value = false;
  showResult.value = true;
}

/** 触发一次智搜（SSE 五阶段） */
function startSearch(): void {
  const q = question.value.trim();
  if (!q) {
    ElMessage.warning('请先输入要研究的问题');
    return;
  }
  resetResult();
  submittedQuestion.value = q;
  stage.value = 'intent';
  running.value = true;

  abortCtrl.value?.abort();
  const ac = new AbortController();
  abortCtrl.value = ac;

  const conditions: SearchConditions = {
    countries: cond.countries,
    indicators: cond.indicators,
    yearFrom: cond.yearFrom,
    yearTo: cond.yearTo,
  };

  searchStream(
    { question: q, mode: mode.value, conditions },
    {
      onStage: (s) => {
        stage.value = s.stage;
      },
      onCondFill: (c) => {
        // AI 回填 → 转 has-val 深色态（可手动微调）
        const cc = c.conditions;
        if (cc.countries?.length) cond.countries = [...cc.countries];
        if (cc.indicators?.length) cond.indicators = [...cc.indicators];
        if (cc.yearFrom != null) cond.yearFrom = cc.yearFrom;
        if (cc.yearTo != null) cond.yearTo = cc.yearTo;
        conditionsFilled.value = true;
      },
      onSource: (s) => {
        sources.value.push(s);
      },
      onReportChunk: (c) => {
        reportText.value += c.text;
      },
      onDone: (d) => {
        doneInfo.value = d;
      },
      onError: (e) => {
        errorMsg.value = e.message;
      },
    },
    ac.signal,
  )
    .catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      errorMsg.value = err instanceof Error ? err.message : '连接中断';
    })
    .finally(() => {
      running.value = false;
      stage.value = 'done';
      question.value = submittedQuestion.value;
      abortCtrl.value = null;
    });
}

/** 中止：AbortController 全链路取消，结束后回填原问题 */
function stopSearch(): void {
  abortCtrl.value?.abort();
}

/** 点击正文角标 → 联动来源卡高亮 */
function onCiteClick(idx: number): void {
  activeCite.value = idx;
  // 若来源卡在右侧不可见，引导平滑滚动
  const card = document.getElementById(`src-${idx}`);
  card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/** 点击来源卡 → 联动正文角标高亮 */
function onSourceClick(idx: number): void {
  activeCite.value = activeCite.value === idx ? null : idx;
}

/** ===== 历史记录 ===== */
const historyVisible = ref(false);
const historyLoading = ref(false);
const histories = ref<SessionListItem[]>([]);

async function openHistory(): Promise<void> {
  historyVisible.value = true;
  historyLoading.value = true;
  try {
    const data = await fetchHistories(1, 30);
    histories.value = data.items;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '历史加载失败');
  } finally {
    historyLoading.value = false;
  }
}

function fillConditions(c: SearchConditions): void {
  cond.countries = c.countries ?? [];
  cond.indicators = c.indicators ?? [];
  cond.yearFrom = c.yearFrom ?? null;
  cond.yearTo = c.yearTo ?? null;
  conditionsFilled.value = hasCond.value;
}

/** 打开历史会话详情 */
async function openHistoryItem(item: SessionListItem): Promise<void> {
  historyVisible.value = false;
  try {
    const detail = await fetchReportDetail(item.id);
    resetResult();
    submittedQuestion.value = item.question;
    question.value = item.question;
    mode.value = (item.mode as SearchMode) || 'hybrid';
    if (item.conditions) fillConditions(item.conditions);
    reportText.value = detail.contentMd;
    sources.value = detail.sources.map((s) => ({
      idx: s.idx,
      title: s.title,
      url: s.url ?? undefined,
      snippet: s.snippet,
      sourceType: s.sourceType,
      isCited: s.isCited,
    }));
    stage.value = 'done';
    running.value = false;
    showResult.value = true;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '报告加载失败');
  }
}

async function onLogout(): Promise<void> {
  await session.logout();
  router.push('/');
}

onBeforeUnmount(() => abortCtrl.value?.abort());
</script>

<template>
  <div class="search-page">
    <!-- 顶栏 -->
    <header class="topbar">
      <div class="brand">
        <svg class="brand-logo" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="7" fill="#2563EB" />
          <path
            d="M14 6.5a7.5 7.5 0 1 0 4.7 13.35l4.22 4.22a1.2 1.2 0 0 0 1.7-1.7l-4.22-4.22A7.5 7.5 0 0 0 14 6.5Zm-3.2 4.3h2v3.2h3.2v2h-3.2v3.2h-2v-3.2H7.6v-2h3.2v-3.2Z"
            fill="#fff"
          />
        </svg>
        <span class="brand-name">AI数智研究平台</span>
      </div>
      <div class="topbar-actions">
        <el-button plain size="small" @click="openHistory">历史记录</el-button>
        <span class="user-name">{{ session.user?.nickname }}</span>
        <el-button link size="small" @click="onLogout">退出</el-button>
      </div>
    </header>

    <main class="search-main">
      <!-- 搜索输入卡 -->
      <section class="query-card">
        <el-input
          v-model="question"
          type="textarea"
          :rows="2"
          resize="none"
          placeholder="提出一个研究问题，例如：美国过去十年的 GDP 增长如何？影响主要因素有哪些？"
        />
        <div class="query-row">
          <div class="mode-group">
            <span class="mode-label">模式</span>
            <el-radio-group v-model="mode" size="small">
              <el-radio-button v-for="m in MODES" :key="m.value" :value="m.value">
                {{ m.label }}
              </el-radio-button>
            </el-radio-group>
          </div>
          <div class="query-actions">
            <el-button v-if="running" type="danger" plain @click="stopSearch">停止</el-button>
            <el-button
              type="primary"
              :loading="running && !isGenerating"
              :disabled="running"
              @click="startSearch"
            >
              智 搜
            </el-button>
          </div>
        </div>

        <!-- 条件栏（AI 回填 has-val 深色态，可手动微调） -->
        <div class="cond-bar" :class="{ 'has-val': hasCond }">
          <span class="cond-title">检索条件</span>
          <el-select
            v-model="cond.countries"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="国家/地区"
            size="small"
            class="cond-item"
          >
          </el-select>
          <el-select
            v-model="cond.indicators"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="指标"
            size="small"
            class="cond-item"
          >
          </el-select>
          <el-input-number
            v-model="cond.yearFrom"
            :min="1900"
            :max="2100"
            :controls="false"
            placeholder="起始年"
            size="small"
            class="cond-year"
          />
          <el-input-number
            v-model="cond.yearTo"
            :min="1900"
            :max="2100"
            :controls="false"
            placeholder="结束年"
            size="small"
            class="cond-year"
          />
          <span v-if="conditionsFilled" class="filled-tip">AI 已回填，可手动微调</span>
        </div>
      </section>

      <!-- 结果区（两栏：左侧报告 + 右侧来源卡） -->
      <section v-if="showResult" class="result-layout">
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
            v-if="errorMsg"
            :title="errorMsg"
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
              @cite-click="onCiteClick"
            />
            <div v-else class="report-empty">
              {{ isGenerating ? '正在生成分析报告…' : '等待生成…' }}
            </div>
            <span v-if="isGenerating" class="caret" />
          </div>
        </div>

        <aside class="source-pane">
          <div class="source-head">
            <span>{{ hasCond ? '已回填条件' : '来源与条件' }}</span>
            <span v-if="sources.length" class="source-count">{{ sources.length }} 条</span>
          </div>

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
      </section>

      <section v-else class="empty-state">
        <div class="empty-logo">
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="#2563EB" />
            <path
              d="M14 6.5a7.5 7.5 0 1 0 4.7 13.35l4.22 4.22a1.2 1.2 0 0 0 1.7-1.7l-4.22-4.22A7.5 7.5 0 0 0 14 6.5Zm-3.2 4.3h2v3.2h3.2v2h-3.2v3.2h-2v-3.2H7.6v-2h3.2v-3.2Z"
              fill="#fff"
            />
          </svg>
        </div>
        <h2 class="empty-title">AI 数智研究 · 智搜</h2>
        <p class="empty-sub">输入问题 → 多源检索 → 智能分析 → 结构化报告</p>
      </section>
    </main>

    <!-- 历史记录抽屉 -->
    <el-drawer v-model="historyVisible" title="历史记录" size="360px" :with-header="true">
      <div v-loading="historyLoading" class="hist-list">
        <div
          v-for="item in histories"
          :key="item.id"
          class="hist-item"
          @click="openHistoryItem(item)"
        >
          <div class="hist-question">{{ item.question }}</div>
          <div class="hist-meta">
            <span>{{ item.mode }}</span>
            <span>{{ new Date(item.createdAt).toLocaleString() }}</span>
          </div>
        </div>
        <el-empty v-if="!historyLoading && !histories.length" description="暂无历史" :image-size="60" />
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.search-page {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #ffffff;
  border-bottom: 1px solid #eef2f7;
  padding: 10px 24px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-logo {
  width: 30px;
  height: 30px;
}

.brand-name {
  font-weight: 600;
  font-size: 16px;
  color: #0f172a;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

.user-name {
  font-size: 14px;
  color: #334155;
}

.search-main {
  flex: 1;
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: 24px 24px 48px;
}

.query-card {
  background: #fff;
  border: 1px solid #eef2f7;
  border-radius: 14px;
  box-shadow: 0 2px 14px rgba(30, 41, 59, 0.04);
  padding: 18px;
}

.query-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
}

.mode-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mode-label {
  font-size: 13px;
  color: #64748b;
}

.query-actions {
  display: flex;
  gap: 10px;
}

.cond-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
  padding: 12px;
  border-radius: 10px;
  background: #f8fafc;
  border: 1px dashed #e2e8f0;
  transition: background 0.3s;
}

.cond-bar.has-val {
  background: #eef2ff;
  border-color: #2563eb;
}

.cond-title {
  font-size: 13px;
  color: #475569;
  white-space: nowrap;
}

.cond-item {
  width: 220px;
}

.cond-year {
  width: 110px;
}

.filled-tip {
  font-size: 12px;
  color: #2563eb;
}

.result-layout {
  display: grid;
  grid-template-columns: 1fr 360px;
  gap: 20px;
  margin-top: 24px;
}

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

.empty-state {
  text-align: center;
  padding: 90px 0 60px;
}

.empty-logo {
  width: 72px;
  height: 72px;
  margin: 0 auto;
  opacity: 0.9;
}

.empty-title {
  margin-top: 24px;
  font-size: 24px;
  font-weight: 700;
  color: #0f172a;
}

.empty-sub {
  margin-top: 10px;
  font-size: 14px;
  color: #64748b;
}

.hist-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hist-item {
  background: #f8fafc;
  border: 1px solid #eef2f7;
  border-radius: 10px;
  padding: 12px 14px;
  cursor: pointer;
  transition: background 0.2s;
}

.hist-item:hover {
  background: #eef2ff;
}

.hist-question {
  font-size: 14px;
  color: #1e293b;
  line-height: 1.5;
}

.hist-meta {
  margin-top: 6px;
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #94a3b8;
}

@media (max-width: 960px) {
  .result-layout {
    grid-template-columns: 1fr;
  }
  .source-pane {
    max-height: none;
    order: 2;
  }
}
</style>