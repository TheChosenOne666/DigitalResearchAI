<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { ErrorCode } from '@app/shared';
import LoginDialog from '@/components/LoginDialog.vue';
import VipGuideDialog from '@/components/VipGuideDialog.vue';
import SearchInputCard from '@/components/search/SearchInputCard.vue';
import SearchProgress from '@/components/search/SearchProgress.vue';
import SourceList from '@/components/search/SourceList.vue';
import SaveToKbDialog from '@/components/search/SaveToKbDialog.vue';
import { useSessionStore } from '@/stores/session';
import { ApiError } from '@/api/http';
import {
  searchStream,
  type SearchConditions,
  type SearchMode,
  type SearchStage,
  type SseSource,
} from '@/api/search';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();

/** 访客检索引导登录弹窗 + 待检索问题（登录成功后自动续跑） */
const loginVisible = ref(false);
const pendingQuestion = ref('');

/** 免费体验配额耗尽引导（M5.3：后端返回 4003 时弹出） */
const vipGuideVisible = ref(false);

/** 落地页快捷检索卡片（对齐原型 SS_SUGS，点击即发起检索） */
const SUGS: Array<{ ic: string; t: string; d: string; q: string }> = [
  { ic: '📁', t: '主要经济体 2025 年 GDP 排名', d: '经济数据 · 一键生成对比榜单', q: '主要经济体 2025 年 GDP 排名' },
  { ic: '📈', t: '比较 2020-2025 年中美 GDP 增长率', d: '图表分析 · 趋势对比与深度解读', q: '比较 2020-2025 年中美 GDP 增长率' },
  { ic: '📊', t: '中国 CPI / PPI 月度走势', d: '宏观监测 · 价格指数走势研判', q: '中国 CPI / PPI 月度走势' },
  { ic: '🌐', t: '全球主要经济体通胀率对比', d: '国际对比 · 多源交叉验证', q: '全球主要经济体通胀率对比' },
];

/** 点击快捷卡片 → 回填问题并发起检索 */
function quickSearch(q: string): void {
  question.value = q;
  startSearch();
}

/** 访客登录成功后：若有待检索问题则自动续跑 */
function onLoginSuccess(): void {
  loginVisible.value = false;
  if (pendingQuestion.value) {
    question.value = pendingQuestion.value;
    pendingQuestion.value = '';
    startSearch();
  }
}

// ===== 输入状态（SearchInputCard 双向绑定）=====

const question = ref('');
const mode = ref<SearchMode>('hybrid');
const submittedQuestion = ref('');

const cond = reactive<{
  countries: string[];
  indicators: string[];
  yearFrom: number | null;
  yearTo: number | null;
}>({ countries: [], indicators: [], yearFrom: null, yearTo: null });
const conditionsFilled = ref(false);

/** 是否有条件被填入（has-val 深色态） */
const hasCond = computed(
  () =>
    cond.countries.length > 0 ||
    cond.indicators.length > 0 ||
    cond.yearFrom != null ||
    cond.yearTo != null,
);

// ===== 运行/阶段/结果状态 =====

const running = ref(false);
const stage = ref<SearchStage>('intent');
const showResult = ref(false);
const reportText = ref('');
const sources = ref<SseSource[]>([]);
const activeCite = ref<number | null>(null);
const errorMsg = ref('');
const doneInfo = ref<{ sessionId: string; reportId: string } | null>(null);

const abortCtrl = ref<AbortController | null>(null);

// ===== 来源勾选 + 存入知识库（M3.4）=====

/** 勾选待存库的来源 idx（默认全部勾选，可取消） */
const checkedIdxs = ref<Set<number>>(new Set());

/** 切换某条来源的勾选态 */
function toggleCheck(idx: number): void {
  const next = new Set(checkedIdxs.value);
  if (next.has(idx)) next.delete(idx);
  else next.add(idx);
  checkedIdxs.value = next;
}

/** 已勾选的来源列表（存入弹窗展示，对齐原型「本次勾选来源」清单） */
const checkedSources = computed(() => sources.value.filter((s) => checkedIdxs.value.has(s.idx)));

/** 「存入知识库」可用：检索已完成且有来源 */
const canSaveKb = computed(() => !running.value && !!doneInfo.value?.sessionId && sources.value.length > 0);

const saveDialogRef = ref<InstanceType<typeof SaveToKbDialog> | null>(null);

function resetResult(): void {
  reportText.value = '';
  sources.value = [];
  errorMsg.value = '';
  doneInfo.value = null;
  activeCite.value = null;
  conditionsFilled.value = false;
  checkedIdxs.value = new Set();
  showResult.value = true;
}

/** 触发一次智搜（SSE 五阶段） */
function startSearch(): void {
  const q = question.value.trim();
  if (!q) {
    ElMessage.warning('请先输入要研究的问题');
    return;
  }
  // 访客检索引导登录（对齐原型 9.31 访客模式：落地页可看，检索需登录）
  if (!session.isLoggedIn) {
    pendingQuestion.value = q;
    loginVisible.value = true;
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
        // 来源默认勾选（供「存入知识库」使用，可手动取消）
        checkedIdxs.value = new Set([...checkedIdxs.value, s.idx]);
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
      // 免费体验配额已用尽 → 弹开通会员引导（不展示为检索错误）
      if (err instanceof ApiError && err.code === ErrorCode.QUOTA_EXCEEDED) {
        vipGuideVisible.value = true;
        return;
      }
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

/** 顶部导航「历史记录」点击 → 带 query.q 跳回首页，此处监听并自动发起检索 */
watch(
  () => route.query.q,
  (q) => {
    if (typeof q === 'string' && q.trim()) {
      question.value = q.trim();
      startSearch();
    }
  },
);

onBeforeUnmount(() => abortCtrl.value?.abort());
</script>

<template>
  <div class="search-page">
    <main class="search-main">
      <!-- 落地态头部（标题，仅未出结果时） -->
      <div v-if="!showResult" class="landing-head">
        <div class="ss-logo">AI</div>
        <h1 class="ss-title">一站式数据智能搜索</h1>
        <p class="ss-sub">输入研究问题，AI 自动完成多源检索、数据标准化、智能分析与研究成果生成</p>
      </div>

      <!-- 搜索输入卡（对齐原型 ss-box：输入行 + 筛选行） -->
      <SearchInputCard
        v-model:question="question"
        v-model:mode="mode"
        v-model:cond="cond"
        v-model:conditions-filled="conditionsFilled"
        :running="running"
        @search="startSearch"
        @stop="stopSearch"
      />

      <!-- 结果区（两栏：左侧报告 + 右侧来源卡） -->
      <section v-if="showResult" class="result-layout">
        <SearchProgress
          :stage="stage"
          :running="running"
          :error="errorMsg"
          :report-text="reportText"
          :active-cite="activeCite"
          @cite-click="onCiteClick"
        />

        <SourceList
          :sources="sources"
          :active-cite="activeCite"
          :checked-idxs="checkedIdxs"
          :can-save-kb="canSaveKb"
          :has-cond="hasCond"
          :cond="cond"
          @toggle-check="toggleCheck"
          @source-click="onSourceClick"
          @save-kb="saveDialogRef?.open()"
        />
      </section>

      <!-- 落地态：快捷卡片 + 能力点 -->
      <template v-else>
        <div class="ss-sugs">
          <button v-for="sug in SUGS" :key="sug.q" class="ss-sug" @click="quickSearch(sug.q)">
            <span class="sug-ic">{{ sug.ic }}</span>
            <span class="sug-txt">
              <b>{{ sug.t }}</b>
              <small>{{ sug.d }}</small>
            </span>
          </button>
        </div>
        <div class="ss-landing-foot">
          <span>覆盖 10+ 数据源</span>
          <span>检索可溯源</span>
          <span>智能可视化</span>
          <span>一键生成 Word</span>
        </div>
      </template>
    </main>

    <!-- 存入知识库弹窗（M3.4：勾选来源逐条转为 Markdown 文档，待审核） -->
    <SaveToKbDialog
      ref="saveDialogRef"
      :checked-sources="checkedSources"
      :checked-idxs="checkedIdxs"
      :session-id="doneInfo?.sessionId ?? null"
    />

    <!-- 访客检索引导登录（对齐原型 9.31：落地页可看，检索需登录） -->
    <LoginDialog v-if="loginVisible" @success="onLoginSuccess" @close="loginVisible = false" />

    <!-- 免费体验配额耗尽引导（M5.3） -->
    <VipGuideDialog
      v-if="vipGuideVisible"
      @close="vipGuideVisible = false"
      @go-vip="vipGuideVisible = false; router.push('/vip')"
    />
  </div>
</template>

<style scoped>
.search-page {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.search-main {
  flex: 1;
  width: 100%;
  max-width: 1020px;
  margin: 0 auto;
  padding: 24px 24px 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* ---- 落地态头部 ---- */

.landing-head {
  text-align: center;
  margin-top: 12px;
}

.ss-logo {
  display: grid;
  width: 62px;
  height: 62px;
  margin: 0 auto;
  place-items: center;
  border-radius: 18px;
  color: #fff;
  font-size: 24px;
  font-weight: 900;
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  box-shadow: 0 14px 30px rgba(37, 99, 235, 0.3);
}

.ss-title {
  margin: 20px 0 8px;
  font-size: 30px;
  font-weight: 800;
  letter-spacing: 0.01em;
  text-align: center;
  color: #0f172a;
}

.ss-sub {
  margin: 0 0 26px;
  color: #64748b;
  font-size: 14px;
  text-align: center;
}

.result-layout {
  display: grid;
  grid-template-columns: 1fr 360px;
  gap: 20px;
  margin-top: 24px;
}

/* ---- 落地态快捷卡片 + 能力点 ---- */

.ss-sugs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  width: min(960px, 100%);
  margin-top: 28px;
}

.ss-sug {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 16px 18px;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  background: #fff;
  cursor: pointer;
  text-align: left;
  transition: transform 0.18s, box-shadow 0.18s, border-color 0.18s;
}

.ss-sug:hover {
  transform: translateY(-2px);
  border-color: #bfdbfe;
  box-shadow: 0 12px 28px rgba(37, 99, 235, 0.12);
}

.sug-ic {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 12px;
  background: #e7f0ff;
  font-size: 19px;
}

.sug-txt b {
  display: block;
  font-size: 14px;
  color: #0f172a;
}

.sug-txt small {
  display: block;
  margin-top: 3px;
  color: #94a3b8;
  font-size: 11.5px;
  line-height: 1.45;
}

.ss-landing-foot {
  margin-top: 24px;
  display: flex;
  align-items: center;
  gap: 16px;
  color: #94a3b8;
  font-size: 12px;
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
