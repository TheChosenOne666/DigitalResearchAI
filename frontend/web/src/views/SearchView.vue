<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { ErrorCode, RETRIEVAL_TTL_SECONDS } from '@app/shared';
import LoginDialog from '@/components/LoginDialog.vue';
import VipGuideDialog from '@/components/VipGuideDialog.vue';
import SearchInputCard from '@/components/search/SearchInputCard.vue';
import SearchProgress from '@/components/search/SearchProgress.vue';
import SourceList from '@/components/search/SourceList.vue';
import SaveToKbDialog from '@/components/search/SaveToKbDialog.vue';
import SearchTaskPanel from '@/components/search/SearchTaskPanel.vue';
import { useSessionStore } from '@/stores/session';
import { ApiError } from '@/api/http';
import {
  searchStream,
  generateStream,
  resumeGenerateStream,
  fetchRetrieval,
  type SearchConditions,
  type SearchMode,
  type SearchStage,
  type SseError,
  type SseSearchRoute,
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
  {
    ic: '📁',
    t: '主要经济体 2025 年 GDP 排名',
    d: '经济数据 · 一键生成对比榜单',
    q: '主要经济体 2025 年 GDP 排名',
  },
  {
    ic: '📈',
    t: '比较 2020-2025 年中美 GDP 增长率',
    d: '图表分析 · 趋势对比与深度解读',
    q: '比较 2020-2025 年中美 GDP 增长率',
  },
  {
    ic: '📊',
    t: '中国 CPI / PPI 月度走势',
    d: '宏观监测 · 价格指数走势研判',
    q: '中国 CPI / PPI 月度走势',
  },
  {
    ic: '🌐',
    t: '全球主要经济体通胀率对比',
    d: '国际对比 · 多源交叉验证',
    q: '全球主要经济体通胀率对比',
  },
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
/** 18 批 3：本次检索附带的本地资料 id（由输入卡「+」上传后回填） */
const uploadIds = ref<string[]>([]);
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
/** 结构化失败明细（逐条换行展示；生成失败时后端逐章给出） */
const errorDetails = ref<string[]>([]);
/** 生成失败后可续跑的任务 id（非空 = 报告区显示内联「继续生成」按钮） */
const resumableTaskId = ref<string | null>(null);
const doneInfo = ref<{ sessionId: string; reportId: string } | null>(null);

// ===== 17 两段式：选择态 / 生成态 =====

/** 页面阶段：检索中 → selecting（等用户勾选）→ generating（第二段生成） */
const phase = ref<'searching' | 'selecting' | 'generating'>('searching');
/** 检索快照会话 id（第一段 sources_ready 返回；供第二段生成与存知识库） */
const retrievalSessionId = ref('');
/**
 * 当前恢复的会话快照是否已过期（超过 TTL）。
 * 只影响选择态提示条与主按钮行为：过期时按钮变「重新检索」，不隐藏会话内容。
 */
const retrievalExpired = ref(false);
/** 18 知识库优先：本次检索的实际路由结果（短路时提示「未联网检索」） */
const routeInfo = ref<SseSearchRoute | null>(null);
/** 18 批 4：任务面板可见性 + 正在续跑的任务 id（防重复点击） */
const taskPanelVisible = ref(false);
const resumingTaskId = ref<string | null>(null);
/** 勾选集 →「开始分析」可用（快照过期的会话除外：过期时按钮为「重新检索」，不置灰） */
const canGenerate = computed(
  () => phase.value === 'selecting' && checkedIdxs.value.size > 0 && !retrievalExpired.value,
);
/** 18 知识库优先：本次检索路提示（让用户看到「有没有查知识库 / 有没有联网」） */
const routeTip = computed(() => {
  const r = routeInfo.value;
  if (!r) return '';
  const usedKb = r.routes.includes('local');
  const usedWeb = r.routes.includes('web') || r.routes.includes('vertical');
  if (r.shortCircuited) {
    return `已命中知识库（${r.localHits} 条，最高相似度 ${Math.round(r.localTopScore * 100)}%），未联网检索`;
  }
  if (usedKb) {
    return `知识库命中不足（${r.localHits} 条），已联网补充检索`;
  }
  return usedWeb ? '本次未命中知识库，已联网检索' : '';
});
/** 生成中 */
const generating = ref(false);

const abortCtrl = ref<AbortController | null>(null);

// ===== 来源勾选 + 存入知识库（M3.4）=====

/** 勾选的来源 idx（选择态：决定哪些来源进报告；同时供存知识库复用） */
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

/** 「存入知识库」可用：选择态或已完成，有来源且有会话 id */
const canSaveKb = computed(
  () =>
    !running.value && !generating.value && !!retrievalSessionId.value && sources.value.length > 0,
);

const saveDialogRef = ref<InstanceType<typeof SaveToKbDialog> | null>(null);

function resetResult(): void {
  reportText.value = '';
  sources.value = [];
  errorMsg.value = '';
  errorDetails.value = [];
  resumableTaskId.value = null;
  doneInfo.value = null;
  activeCite.value = null;
  conditionsFilled.value = false;
  checkedIdxs.value = new Set();
  phase.value = 'searching';
  retrievalSessionId.value = '';
  retrievalExpired.value = false;
  routeInfo.value = null;
  generating.value = false;
  showResult.value = true;
}

/** 统一记录一次失败：明细逐条存（用于换行展示），可续跑任务 id 存下（用于内联重试按钮） */
function recordError(e: SseError): void {
  errorMsg.value = e.message;
  errorDetails.value = e.messages ?? [];
  if (e.taskId) resumableTaskId.value = e.taskId;
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
    { question: q, mode: mode.value, conditions, uploadIds: uploadIds.value },
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
      onSearchRoute: (r) => {
        // 18 知识库优先：记录本次实际检索路（短路时选择态提示「已命中知识库，未联网检索」）
        routeInfo.value = r;
      },
      onSource: (s) => {
        sources.value.push(s);
        // 来源默认全部勾选（选择态可直接「开始分析」；可手动取消）
        checkedIdxs.value = new Set([...checkedIdxs.value, s.idx]);
      },
      onSourcesReady: (r) => {
        // 17 两段式第一段收尾：记住会话 id，进入选择态等待用户勾选
        retrievalSessionId.value = r.sessionId;
      },
      onError: (e) => {
        recordError(e);
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
      question.value = submittedQuestion.value;
      abortCtrl.value = null;
      // 检索完成且有快照会话 → 选择态；否则维持结果区（错误/中止路径）
      if (retrievalSessionId.value && !errorMsg.value) {
        phase.value = 'selecting';
      }
    });
}

/**
 * 选择态主按钮统一入口：
 * - 快照未过期 → 基于勾选来源生成报告（两段式第二段）
 * - 快照已过期 → 提示过期并用原问题重新检索（过期快照无法再用于生成，后端也会拒绝）
 */
function onSelectBarAction(): void {
  if (retrievalExpired.value) {
    ElMessage.warning(
      `检索结果已过期（超过 ${Math.round(RETRIEVAL_TTL_SECONDS / 60)} 分钟），正在重新检索`,
    );
    restartSearch();
    return;
  }
  startGenerate();
}

/** 过期会话「重新检索」：用原问题重跑一次检索（复用 `startSearch`，含试额/限流口径） */
function restartSearch(): void {
  const q = submittedQuestion.value || question.value;
  if (!q.trim()) {
    ElMessage.warning('未记录原问题，请在输入框重新输入后检索');
    return;
  }
  question.value = q;
  startSearch();
}

/** 17 两段式第二段：基于勾选来源生成报告 */
function startGenerate(): void {
  if (phase.value !== 'selecting' || !retrievalSessionId.value) return;
  const selected = [...checkedIdxs.value].sort((a, b) => a - b);
  if (!selected.length) {
    ElMessage.warning('请至少勾选一条来源');
    return;
  }

  phase.value = 'generating';
  generating.value = true;
  reportText.value = '';
  errorMsg.value = '';
  doneInfo.value = null;
  stage.value = 'generating';

  abortCtrl.value?.abort();
  const ac = new AbortController();
  abortCtrl.value = ac;

  generateStream(
    { sessionId: retrievalSessionId.value, selectedIdxs: selected },
    {
      onStage: (s) => {
        stage.value = s.stage;
      },
      onReportChunk: (c) => {
        reportText.value += c.text;
      },
      onDone: (d) => {
        doneInfo.value = d;
      },
      onError: (e) => {
        recordError(e);
      },
    },
    ac.signal,
  )
    .catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      errorMsg.value = err instanceof Error ? err.message : '连接中断';
    })
    .finally(() => {
      generating.value = false;
      abortCtrl.value = null;
      if (errorMsg.value) {
        // 生成失败 → 回选择态（勾选保留，可重试或换勾选）
        phase.value = 'selecting';
        stage.value = 'fusing';
      } else {
        stage.value = 'done';
      }
    });
}

/**
 * 18 批 4：续跑窗口已过期——用原问题重新走一次检索。
 * 复用既有检索流程（含试额与限流口径），不做特殊分支。
 */
function onResearchTask(q: string): void {
  if (!q) {
    ElMessage.warning('该任务未记录问题，请手动输入后重新检索');
    return;
  }
  taskPanelVisible.value = false;
  question.value = q;
  startSearch();
}

/**
 * 18 批 4：继续生成（断点续跑）。
 * 后端从报告断点继续生成剩余章节，已完成章节不重复生成；前端按生成态渲染新章节。
 */
async function onResumeTask(taskId: string, sessionId: string): Promise<void> {
  if (resumingTaskId.value) return;
  resumingTaskId.value = taskId;
  resetResult();
  phase.value = 'generating';
  generating.value = true;
  stage.value = 'generating';

  // 载入检索快照以继续展示来源卡（失败不阻断续跑）
  try {
    const snap = await fetchRetrieval(sessionId);
    retrievalSessionId.value = snap.sessionId;
    sources.value = snap.sources.map((s) => ({
      idx: s.idx,
      title: s.title,
      url: s.url ?? undefined,
      snippet: s.snippet,
      sourceType: s.sourceType,
      isCited: s.isCited,
    }));
    checkedIdxs.value = new Set(snap.sources.filter((s) => s.isCited).map((s) => s.idx));
    submittedQuestion.value = snap.question;
  } catch {
    /* 快照不可用不影响续跑本体 */
  }

  abortCtrl.value?.abort();
  const ac = new AbortController();
  abortCtrl.value = ac;

  try {
    const res = await resumeGenerateStream(
      taskId,
      {
        onStage: (s) => {
          stage.value = s.stage;
        },
        onReportChunk: (c) => {
          reportText.value += c.text;
        },
        onDone: (d) => {
          doneInfo.value = d;
        },
        onError: (e) => {
          recordError(e);
        },
      },
      ac.signal,
    );
    if (res?.reportId) {
      doneInfo.value = res;
      ElMessage.success('报告已补齐');
      taskPanelVisible.value = false;
    }
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    errorMsg.value = err instanceof Error ? err.message : '继续生成失败';
  } finally {
    resumingTaskId.value = null;
    generating.value = false;
    abortCtrl.value = null;
    if (errorMsg.value) {
      phase.value = 'selecting';
      stage.value = 'fusing';
    } else {
      stage.value = 'done';
    }
  }
}

/** 生成完成后重新选择数据：清报告回选择态（不重复检索，勾选保留） */
function reselectSources(): void {
  reportText.value = '';
  doneInfo.value = null;
  errorMsg.value = '';
  errorDetails.value = [];
  resumableTaskId.value = null;
  activeCite.value = null;
  phase.value = 'selecting';
  stage.value = 'fusing';
}

/**
 * 恢复选择态（历史记录点击 / 刷新恢复）：拉快照回填来源与勾选。
 *
 * **无论快照是否过期都照常渲染该会话**——用户点历史记录就是要回到那个记录本身。
 * 过期与否只体现在选择态提示条与主按钮上：未过期 → 「开始分析」；
 * 过期 → 提示条转警示态、主按钮变「重新检索」，点击用原问题重跑检索。
 * 因此这里绝不能因过期直接 return，否则用户只看到提示、看不到会话内容。
 */
async function restoreRetrieval(sessionId: string): Promise<void> {
  try {
    const snap = await fetchRetrieval(sessionId);
    resetResult();
    retrievalSessionId.value = snap.sessionId;
    sources.value = snap.sources.map((s) => ({
      idx: s.idx,
      title: s.title,
      url: s.url ?? undefined,
      snippet: s.snippet,
      sourceType: s.sourceType,
      isCited: s.isCited,
    }));
    // 默认全部勾选（与首次检索一致）
    checkedIdxs.value = new Set(snap.sources.map((s) => s.idx));
    phase.value = 'selecting';
    stage.value = 'fusing';
    question.value = snap.question;
    submittedQuestion.value = snap.question;
    // 过期标记：仅驱动选择态提示条样式与主按钮行为（变「重新检索」），不影响本会话内容的展示
    retrievalExpired.value = snap.expiresInSeconds <= 0;
    if (retrievalExpired.value) {
      ElMessage.warning('检索结果已过期，请重新检索');
    } else {
      ElMessage.success('已恢复上次检索结果，请勾选数据后开始分析');
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '恢复检索结果失败');
  }
}

/**
 * 报告区内联「继续生成」：用失败时后端回传的任务 id 直接续跑，
 * 复用 `onResumeTask`（含快照恢复、事件处理、状态收敛），无需用户打开任务中心。
 */
function onInlineResume(): void {
  const taskId = resumableTaskId.value;
  if (!taskId) {
    ElMessage.warning('未找到可续跑的任务，请到任务中心查看');
    taskPanelVisible.value = true;
    return;
  }
  void onResumeTask(taskId, retrievalSessionId.value);
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

/**
 * 恢复入口（17 两段式）：
 * - query.q：历史记录中无快照的旧会话 → 重新检索
 * - query.retrieval：待选择会话 → 拉快照恢复选择态（不重复检索）
 */
watch(
  () => route.query,
  (q) => {
    const retrieval = q.retrieval;
    if (typeof retrieval === 'string' && retrieval.trim()) {
      restoreRetrieval(retrieval.trim());
      return;
    }
    if (typeof q.q === 'string' && q.q.trim()) {
      question.value = q.q.trim();
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
        v-model:upload-ids="uploadIds"
        :running="running"
        @search="startSearch"
        @stop="stopSearch"
      />

      <!-- 结果区（两栏：左侧报告 + 右侧来源卡） -->
      <section v-if="showResult" class="result-layout">
        <!-- 17 两段式：选择态提示条（等用户勾选数据）
             快照过期的会话照常展示内容，仅提示条变为过期态、按钮变「重新检索」 -->
        <div
          v-if="phase === 'selecting'"
          class="select-bar"
          :class="{ 'expired-bar': retrievalExpired }"
        >
          <div class="select-bar-txt">
            <template v-if="retrievalExpired">
              <b class="expired-title">检索结果已过期</b>
              <span>
                上次检索已超过 {{ Math.round(RETRIEVAL_TTL_SECONDS / 60) }}
                分钟，需重新检索后才能分析（下方为上次检索到的来源，仅供参考）
              </span>
            </template>
            <template v-else>
              <b>检索完成</b>
              <span>已找到 {{ sources.length }} 条数据，请勾选需要分析的内容</span>
              <!-- 18 知识库优先：短路提示（结果来自知识库，未走外网） -->
              <span v-if="routeTip" class="route-tip">{{ routeTip }}</span>
            </template>
          </div>
          <button
            class="select-bar-btn"
            :class="{ expired: retrievalExpired }"
            :disabled="!retrievalExpired && !canGenerate"
            @click="onSelectBarAction"
          >
            {{
              retrievalExpired
                ? '重新检索'
                : generating
                  ? '分析中…'
                  : `开始分析（基于勾选 ${checkedIdxs.size} 条）`
            }}
          </button>
        </div>

        <!-- 生成完成后：重新选择数据（不重复检索） -->
        <div v-if="phase === 'generating' && doneInfo && !generating" class="select-bar done-bar">
          <div class="select-bar-txt">
            <b>报告已生成</b>
            <span>想换一批数据分析？勾选后可重新生成</span>
          </div>
          <button class="select-bar-btn" @click="reselectSources">重新选择数据</button>
        </div>

        <SearchProgress
          :stage="stage"
          :running="running || generating"
          :error="errorMsg"
          :error-details="errorDetails"
          :can-resume="!!resumableTaskId && !generating && !running"
          :resuming="!!resumingTaskId"
          :report-text="reportText"
          :active-cite="activeCite"
          :max-cite="sources.length"
          @cite-click="onCiteClick"
          @resume="onInlineResume"
        />

        <SourceList
          :sources="sources"
          :active-cite="activeCite"
          :checked-idxs="checkedIdxs"
          :can-save-kb="canSaveKb"
          :has-cond="hasCond"
          :cond="cond"
          :disabled="generating"
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

    <!-- 存入知识库弹窗（M3.4：勾选来源逐条转为 Markdown 文档，待审核；17 两段式：会话 id 用检索快照会话） -->
    <SaveToKbDialog
      ref="saveDialogRef"
      :checked-sources="checkedSources"
      :checked-idxs="checkedIdxs"
      :session-id="retrievalSessionId || null"
    />

    <!-- 18 批 4：任务中心入口（浮层按钮）+ 面板 -->
    <button
      class="task-fab"
      title="任务中心：查看检索/生成任务状态，中断的生成可继续"
      @click="taskPanelVisible = true"
    >
      <i class="task-fab-dot" :class="{ busy: generating || running }" />
      任务
    </button>
    <SearchTaskPanel
      v-model:visible="taskPanelVisible"
      :resuming-id="resumingTaskId ?? undefined"
      @resume="onResumeTask"
      @open="(sid) => router.push(`/search/reports/${sid}`)"
      @select="restoreRetrieval"
      @research="onResearchTask"
    />

    <!-- 访客检索引导登录（对齐原型 9.31：落地页可看，检索需登录） -->
    <LoginDialog v-if="loginVisible" @success="onLoginSuccess" @close="loginVisible = false" />

    <!-- 免费体验配额耗尽引导（M5.3） -->
    <VipGuideDialog
      v-if="vipGuideVisible"
      @close="vipGuideVisible = false"
      @go-vip="
        vipGuideVisible = false;
        router.push('/vip');
      "
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

/* ---- 17 两段式：选择态提示条 ---- */

.select-bar {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border: 1px solid #dbe7ff;
  border-radius: 12px;
  background: linear-gradient(120deg, #eff6ff, #f8fafc);
}

.select-bar.done-bar {
  border-color: #d7f0dd;
  background: linear-gradient(120deg, #f0fdf4, #f8fafc);
}

/* 过期会话：内容照常展示，提示条转警示态并引导重新检索 */
.select-bar.expired-bar {
  border-color: #fde3c0;
  background: linear-gradient(120deg, #fffaf0, #f8fafc);
}

.select-bar.expired-bar .expired-title {
  color: #b45309;
}

.select-bar-txt b {
  display: block;
  font-size: 14px;
  color: #0f172a;
}

.select-bar-txt span {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: #64748b;
}

/* 18 知识库优先：短路提示（结果来自知识库，未走外网） */
.select-bar-txt .route-tip {
  display: inline-block;
  margin-top: 6px;
  padding: 2px 8px;
  border-radius: 6px;
  background: #eff4fe;
  color: #1d4ed8;
  font-size: 12px;
  line-height: 18px;
}

/* 18 批 4：任务中心入口（浮动按钮） */
.task-fab {
  position: fixed;
  right: 24px;
  bottom: 28px;
  z-index: 20;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  border: 1px solid #dbe2ea;
  border-radius: 999px;
  background: #fff;
  color: #334155;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.12);
  cursor: pointer;
}

.task-fab:hover {
  border-color: #2563eb;
  color: #1d4ed8;
}

.task-fab-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #cbd5e1;
}

.task-fab-dot.busy {
  background: #2563eb;
  animation: task-pulse 1.2s ease-in-out infinite;
}

@keyframes task-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

.select-bar-btn {
  flex: 0 0 auto;
  height: 38px;
  padding: 0 20px;
  border: none;
  border-radius: 9px;
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  color: #fff;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
}

.select-bar-btn:hover {
  filter: brightness(1.06);
}

.select-bar-btn:disabled {
  background: #cbd5e1;
  cursor: not-allowed;
}

/* 过期态主按钮：引导重新检索（橙色，与提示条同色系） */
.select-bar-btn.expired {
  background: linear-gradient(135deg, #f59e0b, #d97706);
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
  transition:
    transform 0.18s,
    box-shadow 0.18s,
    border-color 0.18s;
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
