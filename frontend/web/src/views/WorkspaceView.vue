<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import TopNav from '@/components/TopNav.vue';
import WorkspaceFilterPanel from '@/components/workspace/WorkspaceFilterPanel.vue';
import WorkspaceChartPanel from '@/components/workspace/WorkspaceChartPanel.vue';
import WorkspaceUploadDialog from '@/components/workspace/WorkspaceUploadDialog.vue';
import WorkspaceAnalyzeDialog from '@/components/workspace/WorkspaceAnalyzeDialog.vue';
import { useLocalUpload, type UploadedFileData } from '@/components/workspace/useLocalUpload';
import {
  ALL_COUNTRIES,
  DEFAULT_COUNTRIES,
  INDICATORS,
  formatIndicatorValue,
  type ChartType,
} from '@/components/workspace/constants';
import {
  fetchDataset,
  analyzeStream,
  collectDataset,
  type DatasetResult,
  type DatasetSeries,
  type AnalyzeParams,
} from '@/api/workspace';

// ===== 页面状态 =====

const indicator = ref<string>('GDP增长率');
const selectedCountries = ref<string[]>([...DEFAULT_COUNTRIES]);
const yearFrom = ref<number>(new Date().getFullYear() - 7);
const yearTo = ref<number>(new Date().getFullYear() - 1);
const dataset = ref<DatasetResult | null>(null);
const loading = ref(false);

/** 列排序：null=按默认顺序，字符串=按该年份值排序 */
const sortYear = ref<string | null>(null);
const sortAsc = ref(true);
/** 行展开元数据的国家名 */
const expanded = ref<string | null>(null);
/** 国家关键词过滤 */
const keyword = ref('');

const curIndicator = computed(() => INDICATORS.find((i) => i.id === indicator.value));

// ===== 上传补充（M4.2）：会话内已并入的本地文件与合并计算 =====

const { uploadedFiles, uploadedEntities, addUploaded, mergeSeries, mergeYears } = useLocalUpload(
  selectedCountries,
);

/** 国家筛选选项 = 内置国家 + 上传实体 */
const countryOptions = computed(() => [...ALL_COUNTRIES, ...uploadedEntities.value]);

/** 合并后的时序序列：WDI 序列 + 上传文件行 */
const series = computed<DatasetSeries[]>(() => mergeSeries(dataset.value?.indicators[0]?.series ?? []));

/** 年份 = WDI 年份 ∪ 上传年份（升序） */
const years = computed(() => mergeYears(dataset.value?.years ?? []));

const sourceLabel = computed(() => {
  if (dataset.value?.source) return dataset.value.source;
  return uploadedFiles.value.length ? '本地文件补充' : '世界发展指标数据库（WDI）';
});

const selCount = computed(() => selectedCountries.value.length);

// ===== 数据加载 =====

let loadTimer: ReturnType<typeof setTimeout> | null = null;

async function load(): Promise<void> {
  if (!selectedCountries.value.length) {
    dataset.value = null;
    return;
  }
  loading.value = true;
  try {
    dataset.value = await fetchDataset({
      countries: selectedCountries.value.filter((c) => ALL_COUNTRIES.includes(c)),
      indicators: [indicator.value],
      yearFrom: yearFrom.value,
      yearTo: yearTo.value,
    });
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '数据加载失败');
  } finally {
    loading.value = false;
  }
}

/** 筛选变更后防抖刷新 */
function scheduleLoad(): void {
  if (loadTimer) clearTimeout(loadTimer);
  loadTimer = setTimeout(load, 300);
}

/** 年份输入合法性：from 不得大于 to */
function clampYears(): void {
  if (yearFrom.value > yearTo.value) {
    const t = yearFrom.value;
    yearFrom.value = yearTo.value;
    yearTo.value = t;
  }
  scheduleLoad();
}

// ===== 表格行计算 =====

const rows = computed(() => {
  let list = series.value.filter((s) => selectedCountries.value.includes(s.country));
  if (keyword.value.trim()) {
    list = list.filter((s) => s.country.includes(keyword.value.trim()));
  }
  if (sortYear.value) {
    const y = sortYear.value;
    list = [...list].sort((a, b) => {
      const x = a.values[y] ?? null;
      const z = b.values[y] ?? null;
      if (x == null && z == null) return 0;
      if (x == null) return 1;
      if (z == null) return -1;
      return (x - z) * (sortAsc.value ? 1 : -1);
    });
  }
  return list;
});

/** 数值格式化（按指标小数位；人口用千分位） */
function fmt(v: number): string {
  return formatIndicatorValue(v, curIndicator.value);
}

/** 单国缺失年份数 */
function missingCount(values: Record<string, number>): number {
  return years.value.filter((y) => values[y] == null).length;
}

function toggleSort(y: string): void {
  if (sortYear.value === y) {
    sortAsc.value = !sortAsc.value;
  } else {
    sortYear.value = y;
    sortAsc.value = true;
  }
}

function toggleExpand(country: string): void {
  expanded.value = expanded.value === country ? null : country;
}

// ===== 筛选面板交互 =====

function toggleCountry(name: string): void {
  const idx = selectedCountries.value.indexOf(name);
  if (idx >= 0) selectedCountries.value.splice(idx, 1);
  else selectedCountries.value.push(name);
  scheduleLoad();
}

function selectAll(): void {
  selectedCountries.value = [...countryOptions.value];
  scheduleLoad();
}

function clearAll(): void {
  selectedCountries.value = [];
  dataset.value = null;
}

// ===== 底部操作：CSV 下载 =====

function downloadCsv(): void {
  if (!rows.value.length) {
    ElMessage.warning('暂无数据可下载');
    return;
  }
  const head = ['国家/地区', ...years.value];
  const body = rows.value.map((r) =>
    [r.country, ...years.value.map((y) => (r.values[y] == null ? '..' : fmt(r.values[y])))],
  );
  const content = [head, ...body].map((row) => row.join(',')).join('\n');
  const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${indicator.value}_${yearFrom.value}-${yearTo.value}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  ElMessage.success('已导出 CSV 文件');
}

// ===== 收藏到我的数据（M4.4）=====

const collecting = ref(false);

/** 组装当前工作台状态为快照并收藏（名称默认 指标_区间，可在我的数据溯源查看） */
async function collectToMyData(): Promise<void> {
  if (!series.value.length) {
    ElMessage.warning('请先选择国家/地区并加载数据');
    return;
  }
  if (collecting.value) return;
  collecting.value = true;
  try {
    const ind = curIndicator.value;
    const hasUpload = series.value.some((s) => s.source);
    await collectDataset({
      name: `${ind?.name ?? indicator.value}_${yearFrom.value}-${yearTo.value}`,
      data: {
        indicator: ind?.name ?? indicator.value,
        countries: selectedCountries.value,
        years: years.value,
        series: series.value.map((s) => ({ country: s.country, values: s.values })),
        sources: series.value
          .filter((s) => s.source)
          .map((s) => ({ name: s.source ?? '', desc: `实体：${s.country}` })),
      },
      tags: [indicator.value],
      sourceType: hasUpload ? (dataset.value ? 'mixed' : 'upload') : 'WDI',
    });
    ElMessage.success('已收藏到「我的数据」，可在个人中心查看');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '收藏失败');
  } finally {
    collecting.value = false;
  }
}

// ===== 生成分析结果（M4.3）=====

const router = useRouter();

const genVisible = ref(false);
const genText = ref('');
const genChars = ref(0);
const genPct = ref(0);
let analyzeAbort: AbortController | null = null;

/** 组装当前工作台状态为分析入参并触发 SSE 流式生成，完成后跳转分析结果页 */
async function generateAnalysis(): Promise<void> {
  if (!series.value.length) {
    ElMessage.warning('请先选择国家/地区并加载数据');
    return;
  }
  const ind = curIndicator.value;
  if (!ind) return;

  const lastYear = years.value.length ? Number(years.value[years.value.length - 1]) : yearTo.value;
  const params: AnalyzeParams = {
    indicator: { name: ind.name, unit: ind.unit, note: ind.note },
    countries: selectedCountries.value,
    years: years.value,
    series: series.value.map((s) => ({ country: s.country, values: s.values })),
    sources: [],
    chartConfig: {
      type: chartType.value,
      from: chartFrom.value,
      to: lastYear,
      label: chartLbl.value,
      grid: chartGrid.value,
    },
  };

  genVisible.value = true;
  genText.value = '正在解析数据与统计口径…';
  genChars.value = 0;
  genPct.value = 20;
  analyzeAbort = new AbortController();

  try {
    const result = await analyzeStream(
      params,
      {
        onStage: (s) => {
          if (s.stage === 'analyzing') {
            genText.value = '正在解析数据与统计口径…';
            genPct.value = 40;
          } else if (s.stage === 'done') {
            genText.value = '分析完成，正在保存报告…';
            genPct.value = 100;
          }
        },
        onReportChunk: (c) => {
          genChars.value += c.text.length;
          genText.value = '正在撰写 14 章节分析报告…';
          genPct.value = Math.min(90, 40 + Math.round(genChars.value / 60));
        },
        onError: (e) => {
          ElMessage.error(e.message || '生成失败');
        },
      },
      analyzeAbort.signal,
    );
    if (result?.reportId) {
      genVisible.value = false;
      router.push(`/workspace/analyze/${result.reportId}`);
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') {
      ElMessage.error(e instanceof Error ? e.message : '生成失败');
    }
  } finally {
    genVisible.value = false;
    analyzeAbort = null;
  }
}

// ===== 视图切换：表格 / 图表 =====

const view = ref<'table' | 'chart'>('table');
/** 图表配置由父组件持有（生成分析时作为 chartConfig 快照入参），图表实例在面板内部 */
const chartType = ref<ChartType>('line');
const chartLbl = ref(true);
const chartGrid = ref(true);
const chartFrom = ref<number>(yearFrom.value);

/** 图表可见年份边界（切换图表视图时钳制区间起点） */
const minYear = computed(() => (years.value.length ? Number(years.value[0]) : yearFrom.value));
const maxYear = computed(() =>
  years.value.length ? Number(years.value[years.value.length - 1]) : yearTo.value,
);

/** 图表渲染的国家（当前选中的实体） */
const chartCountries = computed(() => series.value.filter((s) => selectedCountries.value.includes(s.country)));

function openChart(): void {
  chartType.value = 'line';
  if (!years.value.length || chartFrom.value < minYear.value || chartFrom.value > maxYear.value) {
    chartFrom.value = minYear.value;
  }
  view.value = 'chart';
}

function backToTable(): void {
  view.value = 'table';
}

// ===== 上传弹窗 =====

const uploadDialogRef = ref<InstanceType<typeof WorkspaceUploadDialog> | null>(null);

function openUpload(): void {
  uploadDialogRef.value?.open();
}

/** 上传解析结果并入工作台（新实体自动加入国家筛选） */
function onUploaded(payloads: UploadedFileData[]): void {
  for (const p of payloads) addUploaded(p);
}

watch(indicator, scheduleLoad);

onMounted(load);

onBeforeUnmount(() => {
  analyzeAbort?.abort();
});
</script>

<template>
  <div class="ws-page">
    <TopNav />

    <div class="ws-head">
      <div class="t">数据分析工作台</div>
      <div class="sub">多条件筛选 · 时序对比 · 一键图表 · 多格式导出</div>
      <span class="flex-1"></span>
      <span class="meta" v-if="curIndicator">
        指标：{{ curIndicator.name }} · {{ selCount }} 个国家/地区 · {{ yearFrom }}-{{ yearTo }}
      </span>
    </div>

    <!-- 表格视图 -->
    <div class="ws-body" v-if="view === 'table'">
      <!-- 左侧多级筛选面板 -->
      <WorkspaceFilterPanel
        v-model:keyword="keyword"
        v-model:year-from="yearFrom"
        v-model:year-to="yearTo"
        :country-options="countryOptions"
        :selected-countries="selectedCountries"
        :source-label="sourceLabel"
        @year-change="clampYears"
        @toggle-country="toggleCountry"
        @select-all="selectAll"
        @clear-all="clearAll"
      />

      <!-- 右侧：指标选择 + 时序宽表 -->
      <div class="ws-right">
        <div class="ws-ind">
          <label>分析指标</label>
          <select v-model="indicator">
            <option v-for="i in INDICATORS" :key="i.id" :value="i.id">{{ i.name }}</option>
          </select>
          <span class="info-ic" :title="curIndicator?.note">i</span>
          <span class="flex-1"></span>
          <span class="ind-note" v-if="curIndicator">{{ yearFrom }}-{{ yearTo }} · 单位：{{ curIndicator.unit }}</span>
        </div>

        <div class="ws-table" v-loading="loading">
          <div v-if="!rows.length" class="ws-empty">
            {{ selectedCountries.length ? '该条件下暂无数据，请调整筛选' : '请选择国家/地区后查看数据' }}
          </div>
          <table v-else>
            <thead>
              <tr>
                <th class="sticky-col" @click="sortYear = null">
                  国家/地区
                  <span v-if="sortYear === null">{{ sortAsc ? ' ▲' : ' ▼' }}</span>
                </th>
                <th
                  v-for="y in years"
                  :key="y"
                  :class="{ 'y-odd': Number(y) % 2 === 1 }"
                  @click="toggleSort(y)"
                >
                  {{ y }}<span v-if="sortYear === y">{{ sortAsc ? ' ▲' : ' ▼' }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <template v-for="r in rows" :key="r.country">
                <tr>
                  <td class="sticky-col" @click="toggleExpand(r.country)">
                    <span class="row-x">
                      <span class="arr">{{ expanded === r.country ? '▼' : '▶' }}</span>{{ r.country }}
                    </span>
                  </td>
                  <td
                    v-for="y in years"
                    :key="y"
                    :class="[r.values[y] == null ? 'na' : '', Number(y) % 2 === 1 ? 'y-odd' : '']"
                  >
                    {{ r.values[y] == null ? '..' : fmt(r.values[y]) }}
                  </td>
                </tr>
                <tr v-if="expanded === r.country" class="meta-row">
                  <td class="sticky-col"></td>
                  <td :colspan="years.length">
                    <div class="m-wrap">
                      <span class="m-item">数据来源<b>{{ r.source ?? sourceLabel }}</b></span>
                      <span class="m-item">口径<b>{{ curIndicator?.name }}</b></span>
                      <span class="m-item">单位<b>{{ curIndicator?.unit }}</b></span>
                      <span class="m-item">缺失年份<b>{{ missingCount(r.values) }} 个</b></span>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>

        <div class="ws-src-note">
          <span>数据来源：{{ sourceLabel }}</span>
          <span>行维度为国家/地区，列维度为年份</span>
        </div>

        <div class="ws-opbar">
          <span class="op" @click="downloadCsv">
            <svg class="ic" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
            下载 CSV
          </span>
          <span class="op primary" @click="openChart">
            <svg class="ic" viewBox="0 0 24 24" fill="none"><path d="M4 19V9m6 10V5m6 14v-7m4 7V3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
            生成数据图表
          </span>
          <span class="op primary" @click="generateAnalysis">
            <svg class="ic" viewBox="0 0 24 24" fill="none"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" /></svg>
            生成分析结果
          </span>
          <span class="op" @click="openUpload">
            <svg class="ic" viewBox="0 0 24 24" fill="none"><path d="M12 16V4m0 0L8 8m4-4l4 4M4 20h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
            数据上传补充
          </span>
          <span class="flex-1"></span>
          <span class="op" :class="{ disabled: collecting }" @click="collectToMyData">
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 3.5l2.5 5.6 6.1.6-4.6 4.1 1.3 6-5.3-3.1-5.3 3.1 1.3-6-4.6-4.1 6.1-.6L12 3.5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /></svg>
            收藏到我的数据
          </span>
        </div>
      </div>
    </div>

    <!-- 图表视图 -->
    <WorkspaceChartPanel
      v-else
      v-model:chart-type="chartType"
      v-model:chart-lbl="chartLbl"
      v-model:chart-grid="chartGrid"
      v-model:chart-from="chartFrom"
      :indicator-meta="curIndicator"
      :countries="chartCountries"
      :years="years"
      @back="backToTable"
    />

    <!-- 上传补充弹窗 -->
    <WorkspaceUploadDialog ref="uploadDialogRef" @committed="onUploaded" />

    <!-- 生成分析结果进度弹窗 -->
    <WorkspaceAnalyzeDialog v-model="genVisible" :text="genText" :chars="genChars" :pct="genPct" />
  </div>
</template>

<style scoped>
.ws-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f8fafc;
}

.ws-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 24px;
  border-bottom: 1px solid #eef2f7;
  background: #fff;
}

.ws-head .t {
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
}

.ws-head .sub {
  font-size: 12.5px;
  color: #94a3b8;
}

.ws-head .meta {
  font-size: 12.5px;
  color: #64748b;
}

.flex-1 {
  flex: 1;
}

.ws-body {
  flex: 1;
  display: flex;
  min-height: 0;
  max-width: 1440px;
  width: 100%;
  margin: 0 auto;
}

/* 右侧 */
.ws-right {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 0 20px 20px;
}

.ws-ind {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 0;
}

.ws-ind label {
  font-size: 13px;
  font-weight: 700;
  color: #64748b;
}

.ws-ind select {
  min-width: 280px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 13px;
  outline: none;
  background: #fff;
}

.ws-ind select:focus {
  border-color: #2563eb;
}

.info-ic {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid #cbd5e1;
  color: #94a3b8;
  font-size: 12px;
  font-style: italic;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: help;
}

.ind-note {
  font-size: 12px;
  color: #94a3b8;
}

/* 时序宽表 */
.ws-table {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: #fff;
  border: 1px solid #eef2f7;
  border-radius: 12px;
}

.ws-table table {
  border-collapse: collapse;
  width: max-content;
  min-width: 100%;
  font-size: 13px;
}

.ws-table th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #f8fafc;
  padding: 10px 14px;
  text-align: right;
  font-weight: 600;
  color: #475569;
  border-bottom: 1px solid #eef2f7;
  cursor: pointer;
  white-space: nowrap;
}

.ws-table th.y-odd {
  background: #f1f6fd;
}

.ws-table td {
  padding: 9px 14px;
  text-align: right;
  color: #1e293b;
  border-bottom: 1px solid #f1f5f9;
  white-space: nowrap;
}

.ws-table td.y-odd {
  background: #f6f9fe;
}

.ws-table td.na {
  color: #cbd5e1;
}

.ws-table .sticky-col {
  position: sticky;
  left: 0;
  z-index: 1;
  background: #fff;
  text-align: left;
  font-weight: 500;
  box-shadow: 1px 0 0 #eef2f7;
}

.ws-table th.sticky-col {
  z-index: 3;
  background: #f8fafc;
}

.row-x {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: #2563eb;
}

.row-x .arr {
  font-size: 10px;
  color: #94a3b8;
}

.meta-row td {
  background: #fbfdff;
  text-align: left;
  padding: 8px 14px;
}

.m-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 28px;
}

.m-item {
  font-size: 12.5px;
  color: #94a3b8;
}

.m-item b {
  margin-left: 6px;
  color: #475569;
  font-weight: 500;
}

.ws-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 240px;
  color: #94a3b8;
  font-size: 13.5px;
}

/* 来源标注 + 底部操作栏 */
.ws-src-note {
  display: flex;
  gap: 20px;
  padding: 10px 2px;
  font-size: 12px;
  color: #94a3b8;
}

.ws-opbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: #fff;
  border: 1px solid #eef2f7;
  border-radius: 12px;
}

.op {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 13px;
  color: #475569;
  cursor: pointer;
  border: 1px solid #e2e8f0;
  background: #fff;
}

.op:hover {
  border-color: #2563eb;
  color: #2563eb;
}

.op.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.op.primary {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}

.op.primary:hover {
  background: #1d4ed8;
}

.ic {
  width: 15px;
  height: 15px;
}
</style>
