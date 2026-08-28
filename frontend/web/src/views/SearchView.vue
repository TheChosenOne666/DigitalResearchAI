<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { ErrorCode } from '@app/shared';
import MarkdownView from '@/components/MarkdownView.vue';
import LoginDialog from '@/components/LoginDialog.vue';
import VipGuideDialog from '@/components/VipGuideDialog.vue';
import { useSessionStore } from '@/stores/session';
import { ApiError } from '@/api/http';
import {
  searchStream,
  type SearchConditions,
  type SearchMode,
  type SearchStage,
  type SseSource,
} from '@/api/search';
import {
  listLibraries,
  listGroups,
  saveSourcesToKb,
  type KbLibrary,
  type KbGroup,
} from '@/api/kb';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();

/** 访客检索引导登录弹窗 + 待检索问题（登录成功后自动续跑） */
const loginVisible = ref(false);
const pendingQuestion = ref('');

/** 免费体验配额耗尽引导（M5.3：后端返回 4003 时弹出） */
const vipGuideVisible = ref(false);

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

/** 「+」上传入口（M4 数据源接入实现，暂占位） */
function onUpload(): void {
  ElMessage.info('外部数据上传（Excel/CSV）将在数据源接入中提供');
}

/** 一键清空 4 项筛选条件 */
function resetCond(): void {
  cond.countries = [];
  cond.indicators = [];
  cond.yearFrom = null;
  cond.yearTo = null;
  conditionsFilled.value = false;
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

/** ===== 来源勾选 + 存入知识库（M3.4）===== */

/** 勾选待存库的来源 idx（默认全部勾选，可取消） */
const checkedIdxs = ref<Set<number>>(new Set());

/** 切换某条来源的勾选态 */
function toggleCheck(idx: number): void {
  const next = new Set(checkedIdxs.value);
  if (next.has(idx)) next.delete(idx);
  else next.add(idx);
  checkedIdxs.value = next;
}

const checkedCount = computed(() => checkedIdxs.value.size);

/** 已勾选的来源列表（存入弹窗展示，对齐原型「本次勾选来源」清单） */
const checkedSources = computed(() => sources.value.filter((s) => checkedIdxs.value.has(s.idx)));

/** 「存入知识库」可用：检索已完成且有来源 */
const canSaveKb = computed(() => !running.value && !!doneInfo.value?.sessionId && sources.value.length > 0);

const saveVisible = ref(false);
const saving = ref(false);
const saveForm = reactive({
  libraryId: '',
  groupId: '',
  visibility: 'PRIVATE',
  tags: '',
});
const kbLibs = ref<KbLibrary[]>([]);
const kbGroups = ref<KbGroup[]>([]);

async function openSaveDialog(): Promise<void> {
  if (!doneInfo.value?.sessionId) {
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
  saveVisible.value = true;
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
  if (!doneInfo.value?.sessionId) return;
  saving.value = true;
  try {
    const tags = saveForm.tags
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean);
    const r = await saveSourcesToKb(doneInfo.value.sessionId, {
      idxs: [...checkedIdxs.value],
      libraryId: saveForm.libraryId,
      groupId: saveForm.groupId || null,
      visibility: saveForm.visibility,
      tags,
    });
    saveVisible.value = false;
    ElMessage.success(`已提交管理员审核（${r.created} 条来源），审核通过后自动学习入库`);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '存入失败');
  } finally {
    saving.value = false;
  }
}

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
            @click="openSaveDialog"
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
    <el-dialog v-model="saveVisible" title="存入知识库" width="480px">
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
        <el-button @click="saveVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitSaveKb">
          提交审核（{{ checkedCount }} 条）
        </el-button>
      </template>
    </el-dialog>

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

/* ---- 输入卡（对齐原型 ss-box） ---- */

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

/* ---- 存入知识库弹窗 ---- */

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