<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import * as echarts from 'echarts';
import TopNav from '@/components/TopNav.vue';
import {
  fetchDataset,
  uploadDataset,
  analyzeStream,
  type DatasetResult,
  type DatasetSeries,
  type AnalyzeParams,
} from '@/api/workspace';

// ===== 指标/国家字典（对齐后端 vertical.connector 的 COUNTRY_ISO3 / INDICATOR_WDI 中文名） =====

interface IndicatorMeta {
  id: string;
  name: string;
  unit: string;
  decimals: number;
  note: string;
}

const INDICATORS: IndicatorMeta[] = [
  { id: 'GDP增长率', name: 'GDP 年增长率（%）', unit: '%', decimals: 2, note: '按不变价计算的国内生产总值年度同比增速，反映经济体扩张速度。' },
  { id: '人均GDP', name: '人均 GDP（现价美元）', unit: '美元', decimals: 0, note: '国内生产总值除以年中人口，反映人均产出水平。' },
  { id: '通货膨胀率', name: '居民消费价格指数 CPI 同比（%）', unit: '%', decimals: 2, note: '反映居民消费价格水平年度同比变化，是衡量通胀的核心指标。' },
  { id: '人口', name: '人口总量（人）', unit: '人', decimals: 0, note: '年中常住人口规模，反映经济体市场规模。' },
  { id: '城镇化率', name: '城镇化率（%）', unit: '%', decimals: 2, note: '城镇常住人口占常住总人口的比重，反映城市化发展水平。' },
  { id: '失业率', name: '失业率（%）', unit: '%', decimals: 2, note: '劳动力中失业人口所占比重，反映就业市场景气度。' },
];

const ALL_COUNTRIES = [
  '中国', '美国', '日本', '德国', '英国', '法国', '印度', '巴西',
  '俄罗斯', '韩国', '加拿大', '澳大利亚', '意大利', '西班牙', '墨西哥',
  '印度尼西亚', '土耳其', '荷兰', '沙特阿拉伯', '瑞士', '新加坡', '南非',
];

/** 默认选中的核心经济体（首次加载避免一次请求过多国家） */
const DEFAULT_COUNTRIES = ['中国', '美国', '日本', '德国', '英国', '法国', '印度', '巴西'];

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

// ===== 上传补充（M4.2）=====

interface UploadedFileData {
  filename: string;
  rows: Array<{ name: string; values: Record<string, number> }>;
  years: string[];
}

/** 已上传并并入的本地文件（会话态，不落库） */
const uploadedFiles = ref<UploadedFileData[]>([]);
const uploadVisible = ref(false);
const pendingFiles = ref<File[]>([]);
const uploading = ref(false);

/** 上传引入的实体名（追加到国家筛选列表） */
const uploadedEntities = computed(() => {
  const names: string[] = [];
  for (const uf of uploadedFiles.value) {
    for (const r of uf.rows) {
      if (!names.includes(r.name)) names.push(r.name);
    }
  }
  return names;
});

/** 国家筛选选项 = 内置国家 + 上传实体 */
const countryOptions = computed(() => [...ALL_COUNTRIES, ...uploadedEntities.value]);

/**
 * 合并后的时序序列：WDI 序列 + 上传文件行（同名实体合并填充、新实体追加）。
 * 上传仅并入当前指标视图（切换指标后以 WDI 数据为准）。
 */
const series = computed<DatasetSeries[]>(() => {
  const base = dataset.value?.indicators[0]?.series ?? [];
  const merged = base.map((s) => ({ ...s }));
  for (const uf of uploadedFiles.value) {
    for (const row of uf.rows) {
      const hit = merged.find((s) => s.country === row.name);
      if (hit) {
        hit.values = { ...hit.values, ...row.values };
        hit.source = hit.source ?? `本地文件 · ${uf.filename}`;
      } else {
        merged.push({ country: row.name, iso3: '', values: { ...row.values }, source: `本地文件 · ${uf.filename}` });
      }
    }
  }
  return merged;
});

/** 年份 = WDI 年份 ∪ 上传年份（升序） */
const years = computed(() => {
  const set = new Set<string>(dataset.value?.years ?? []);
  for (const uf of uploadedFiles.value) {
    for (const y of uf.years) set.add(y);
  }
  return [...set].sort((a, b) => Number(a) - Number(b));
});

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
  if (indicator.value === '人口') {
    return v.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
  }
  return v.toFixed(curIndicator.value?.decimals ?? 2);
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

/** M4.3–M4.4 占位功能 */
function comingSoon(name: string): void {
  ElMessage.info(`「${name}」将在后续批次开放`);
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

// ===== 上传补充（M4.2）=====

function openUpload(): void {
  pendingFiles.value = [];
  uploadVisible.value = true;
}

function onPickFiles(e: Event): void {
  const input = e.target as HTMLInputElement;
  if (!input.files) return;
  const arr = Array.from(input.files);
  if (!arr.length) return;
  pendingFiles.value.push(...arr);
  ElMessage.success(`已选择 ${arr.length} 个文件，点击「完成」并入数据分析`);
  input.value = '';
}

function onDropFiles(e: DragEvent): void {
  const arr = Array.from(e.dataTransfer?.files ?? []);
  if (!arr.length) return;
  const ok = arr.filter((f) => /\.(xlsx|xls|csv)$/i.test(f.name));
  if (!ok.length) {
    ElMessage.warning('仅支持 Excel（.xlsx / .xls）或 CSV 文件');
    return;
  }
  pendingFiles.value.push(...ok);
  ElMessage.success(`已选择 ${ok.length} 个文件，点击「完成」并入数据分析`);
}

function removeFile(i: number): void {
  pendingFiles.value.splice(i, 1);
}

async function commitUpload(): Promise<void> {
  if (!pendingFiles.value.length) {
    ElMessage.warning('本次未选择本地文件');
    return;
  }
  uploading.value = true;
  try {
    for (const f of pendingFiles.value) {
      const res = await uploadDataset(f);
      uploadedFiles.value.push({ filename: f.name, rows: res.rows, years: res.years });
      for (const r of res.rows) {
        if (!selectedCountries.value.includes(r.name)) selectedCountries.value.push(r.name);
      }
    }
    ElMessage.success(`已并入 ${pendingFiles.value.length} 个本地文件，表格与筛选已更新`);
    pendingFiles.value = [];
    uploadVisible.value = false;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '上传解析失败');
  } finally {
    uploading.value = false;
  }
}

// ===== 图表视图（M4.2）=====

type ChartType = 'line' | 'bar' | 'area' | 'radar';
const CHART_COLORS = ['#2563EB', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6', '#06B6D4'];
const CHART_TYPE_NAME: Record<ChartType, string> = {
  line: '折线趋势图',
  bar: '柱状对比图',
  area: '面积走势图',
  radar: '雷达对比图',
};

const view = ref<'table' | 'chart'>('table');
const chartType = ref<ChartType>('line');
const chartLbl = ref(true);
const chartGrid = ref(true);
const chartFrom = ref<number>(yearFrom.value);
const chartEl = ref<HTMLElement>();
let chart: echarts.ECharts | undefined;

const minYear = computed(() => (years.value.length ? Number(years.value[0]) : yearFrom.value));
const maxYear = computed(() => (years.value.length ? Number(years.value[years.value.length - 1]) : yearTo.value));

/** 图表可见年份（区间滑块起点之后） */
const visibleYears = computed(() => years.value.filter((y) => Number(y) >= chartFrom.value));
/** 图表渲染的国家（当前选中的实体） */
const chartCountries = computed(() => series.value.filter((s) => selectedCountries.value.includes(s.country)));

/** 雷达图取代表性年份：区间内最多 3 个（首/中/尾） */
function pickRadarYears(ys: string[]): string[] {
  if (ys.length <= 3) return ys;
  return [ys[0], ys[Math.floor(ys.length / 2)], ys[ys.length - 1]];
}

/** 雷达图坐标轴最大值（区间内全部国家×年份的最大值） */
function radarMax(ys: string[]): number {
  let m = 0;
  for (const c of chartCountries.value) {
    for (const y of ys) {
      const v = c.values[y];
      if (v != null && v > m) m = v;
    }
  }
  return m || 1;
}

function buildOption(): echarts.EChartsOption | null {
  const ys = visibleYears.value;
  const cs = chartCountries.value;
  if (!ys.length || !cs.length) return null;

  if (chartType.value === 'radar') {
    const ryears = pickRadarYears(ys);
    const rmax = radarMax(ys);
    return {
      color: CHART_COLORS,
      tooltip: { trigger: 'item' },
      legend: { data: ryears.map((y) => `${y}年`), top: 0 },
      radar: {
        indicator: cs.map((c) => ({ name: c.country, max: rmax })),
        radius: '62%',
        splitArea: { show: chartGrid.value },
      },
      series: [
        {
          type: 'radar',
          data: ryears.map((y) => ({
            name: `${y}年`,
            value: cs.map((c) => c.values[y] ?? 0),
            label: { show: chartLbl.value, fontSize: 10 },
          })),
        },
      ],
    };
  }

  const isArea = chartType.value === 'area';
  // 面积图映射为带 areaStyle 的折线；非雷达类型仅剩 line / bar
  const seriesType: 'line' | 'bar' = isArea || chartType.value === 'line' ? 'line' : 'bar';
  const seriesOpt = cs.map((c) => ({
    name: c.country,
    type: seriesType,
    smooth: seriesType === 'line',
    areaStyle: isArea ? { opacity: 0.14 } : undefined,
    symbol: 'circle',
    symbolSize: 6,
    data: ys.map((y) => c.values[y] ?? null),
    label: { show: chartLbl.value, position: 'top', fontSize: 10, color: '#64748B' },
    ...(seriesType === 'bar' ? { barMaxWidth: 16 } : {}),
  })) as echarts.EChartsOption['series'];
  return {
    color: CHART_COLORS,
    tooltip: { trigger: 'axis' },
    legend: { type: 'scroll', data: cs.map((c) => c.country), top: 0 },
    grid: { left: 60, right: 24, top: 44, bottom: 30 },
    xAxis: {
      type: 'category',
      data: ys,
      boundaryGap: seriesType === 'bar',
      axisLine: { lineStyle: { color: '#CBD5E1' } },
      axisLabel: { color: '#64748B' },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#64748B' },
      splitLine: chartGrid.value
        ? { lineStyle: { type: 'dashed', color: '#E2E8F0' } }
        : { show: false },
    },
    series: seriesOpt,
  };
}

function renderChart(): void {
  if (!chart || view.value !== 'chart') return;
  const opt = buildOption();
  chart.clear();
  if (opt) chart.setOption(opt, true);
}

async function openChart(): Promise<void> {
  chartType.value = 'line';
  if (!years.value.length || chartFrom.value < minYear.value || chartFrom.value > maxYear.value) {
    chartFrom.value = minYear.value;
  }
  view.value = 'chart';
  await nextTick();
  if (!chart && chartEl.value) {
    chart = echarts.init(chartEl.value);
  }
  chart?.resize();
  renderChart();
}

function backToTable(): void {
  chart?.dispose();
  chart = undefined;
  view.value = 'table';
}

function exportChartPng(): void {
  if (!chart) {
    ElMessage.warning('暂无图表可导出');
    return;
  }
  const url = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' });
  const a = document.createElement('a');
  a.href = url;
  a.download = 'chart.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  ElMessage.success('已导出 PNG 图表');
}

function exportChartSvg(): void {
  if (!chart) {
    ElMessage.warning('暂无图表可导出');
    return;
  }
  const svg = chart.renderToSVGString();
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'chart.svg';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  ElMessage.success('已导出 SVG 图表');
}

/** 图例：选中国家 + 最新年份值 */
const legendItems = computed(() =>
  chartCountries.value.map((c, i) => ({
    name: c.country,
    color: CHART_COLORS[i % CHART_COLORS.length],
    latest: c.values[maxYear.value] ?? null,
  })),
);

/** 长周期走势研判（简明文案） */
const trendText = computed(() => {
  const cs = chartCountries.value;
  const ys = visibleYears.value;
  if (!cs.length || !ys.length) return '暂无可研判数据';
  const last = ys[ys.length - 1];
  const first = ys[0];
  const sorted = [...cs].sort(
    (a, b) => (b.values[last] ?? -Infinity) - (a.values[last] ?? -Infinity),
  );
  const top = sorted[0];
  const s = top.values[first];
  const e = top.values[last];
  const dir = s == null || e == null ? '波动' : e >= s ? '上行' : '下行';
  return `${top.country} 在 ${chartFrom.value}-${last} 区间整体呈${dir}趋势，最新值 ${e == null ? '..' : fmt(e)}；建议结合产业政策与库存周期做多周期交叉验证。`;
});

watch([chartType, chartLbl, chartGrid, chartFrom, chartCountries, visibleYears], () => {
  renderChart();
});

onMounted(load);
watch(indicator, scheduleLoad);
onBeforeUnmount(() => {
  chart?.dispose();
  chart = undefined;
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
      <aside class="ws-fp">
        <div class="fp-head">
          <b>多级筛选</b>
          <span class="cnt">已选 {{ selCount }}</span>
        </div>

        <div class="fp-batch">
          <button @click="clearAll">清空选中</button>
          <button @click="selectAll">全选国家</button>
        </div>

        <div class="fp-search">
          <input v-model="keyword" placeholder="关键词检索国家/地区…" />
        </div>

        <div class="fp-group">
          <div class="fp-title">时间（年份）</div>
          <div class="fp-year">
            <input v-model.number="yearFrom" type="number" min="1990" max="2100" @change="clampYears" />
            <span>—</span>
            <input v-model.number="yearTo" type="number" min="1990" max="2100" @change="clampYears" />
          </div>
        </div>

        <div class="fp-group">
          <div class="fp-title">国家 / 地区 <span class="cnt">{{ selCount }}/{{ countryOptions.length }}</span></div>
          <div class="fp-list">
            <label
              v-for="c in countryOptions"
              :key="c"
              class="fp-item"
              :class="{ on: selectedCountries.includes(c) }"
            >
              <input type="checkbox" :checked="selectedCountries.includes(c)" @change="toggleCountry(c)" />
              <span>{{ c }}</span>
            </label>
          </div>
        </div>

        <div class="fp-group">
          <div class="fp-title">数据来源</div>
          <div class="fp-src">{{ sourceLabel }}</div>
        </div>
      </aside>

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
          <span class="op" @click="comingSoon('收藏到我的数据')">
            <svg class="ic" viewBox="0 0 24 24" fill="none"><path d="M12 3l2.7 5.7 6.3.8-4.6 4.4 1.2 6.2L12 17.3 6.4 20l1.2-6.2L3 9.5l6.3-.8L12 3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /></svg>
            收藏到我的数据
          </span>
        </div>
      </div>
    </div>

    <!-- 图表视图 -->
    <div class="ws-body ws-chart-body" v-else>
      <div class="chart-head">
        <button class="btn-back" @click="backToTable">
          <svg class="ic" viewBox="0 0 24 24" fill="none"><path d="M19 12H5m0 0l6-6m-6 6l6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
          返回工作台
        </button>
        <div class="chart-types">
          <button
            v-for="t in (['line', 'bar', 'area', 'radar'] as ChartType[])"
            :key="t"
            class="ct"
            :class="{ on: chartType === t }"
            @click="chartType = t"
          >
            {{ { line: '折线图', bar: '柱状图', area: '面积图', radar: '雷达图' }[t] }}
          </button>
        </div>
        <span class="flex-1"></span>
        <div class="chart-tools">
          <label class="chk"><input type="checkbox" v-model="chartLbl" /> 数据标签</label>
          <label class="chk"><input type="checkbox" v-model="chartGrid" /> 网格线</label>
          <span class="op" @click="exportChartPng">
            <svg class="ic" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
            导出 PNG
          </span>
          <span class="op" @click="exportChartSvg">
            <svg class="ic" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
            导出 SVG
          </span>
        </div>
      </div>

      <div class="chart-main">
        <div class="chart-card">
          <div class="chart-title">
            <b v-if="curIndicator">{{ curIndicator.name }} · {{ chartFrom }}-{{ maxYear }} 可视化</b>
          </div>
          <div class="chart-canvas" ref="chartEl"></div>
        </div>

        <div class="chart-range">
          <span class="rl">时间区间</span>
          <input
            type="range"
            :min="minYear"
            :max="maxYear"
            v-model.number="chartFrom"
          />
          <span class="rv">{{ chartFrom }} - {{ maxYear }}</span>
        </div>
      </div>

      <div class="chart-side">
        <div class="card">
          <div class="hd">图例</div>
          <div class="legend" v-if="legendItems.length">
            <div v-for="it in legendItems" :key="it.name" class="legend-item">
              <span class="sw" :style="{ background: it.color }"></span>
              <span class="nm">{{ it.name }}</span>
              <span class="flex-1"></span>
              <b>{{ it.latest == null ? '..' : fmt(it.latest) }}</b>
            </div>
          </div>
          <div class="empty-tip" v-else>暂无选中数据</div>
        </div>
        <div class="card">
          <div class="hd">长周期走势研判</div>
          <div class="trend">{{ trendText }}</div>
        </div>
        <div class="card">
          <div class="hd">智能图表推荐</div>
          <div class="rec-list">
            <span
              v-for="t in (['line', 'bar', 'area', 'radar'] as ChartType[])"
              :key="t"
              class="rec"
              :class="{ on: chartType === t }"
              @click="chartType = t"
            >
              {{ CHART_TYPE_NAME[t] }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 上传补充弹窗 -->
    <el-dialog v-model="uploadVisible" title="上传本地文件" width="520px" :close-on-click-modal="false">
      <div class="up-drop" @click="() => ($refs.upInput as HTMLInputElement).click()" @dragover.prevent @drop.prevent="onDropFiles">
        <div class="up-ic">
          <svg viewBox="0 0 24 24" fill="none"><path d="M12 16V4m0 0L8 8m4-4l4 4M4 20h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </div>
        <div class="up-t">点击上传或拖拽本地文件到此处</div>
        <div class="up-s">支持 Excel（.xlsx / .xls）、CSV · 可批量上传多个文件</div>
      </div>
      <input
        ref="upInput"
        type="file"
        accept=".xlsx,.xls,.csv"
        multiple
        style="display: none"
        @change="onPickFiles"
      />
      <div class="up-list" v-if="pendingFiles.length">
        <div v-for="(f, i) in pendingFiles" :key="f.name + i" class="up-file">
          <span class="up-name">{{ f.name }}</span>
          <span class="up-size">{{ (f.size / 1024).toFixed(0) }} KB</span>
          <span class="link" @click="removeFile(i)">移除</span>
        </div>
      </div>
      <div class="up-note">上传的本地文件将即时并入当前数据分析工作台，支持与平台多源数据合并分析、即时更新表格与图表。</div>
      <template #footer>
        <el-button @click="uploadVisible = false">取消</el-button>
        <el-button type="primary" :loading="uploading" @click="commitUpload">完成</el-button>
      </template>
    </el-dialog>

    <!-- 生成分析结果进度弹窗 -->
    <el-dialog v-model="genVisible" title="生成分析结果" width="420px" :close-on-click-modal="false" :show-close="false">
      <div class="gen-progress">
        <div class="gen-ic">
          <svg viewBox="0 0 24 24" fill="none"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" /></svg>
        </div>
        <div class="gen-text">{{ genText }}</div>
        <div class="gen-sub" v-if="genChars > 0">已生成 {{ genChars }} 字</div>
        <el-progress :percentage="genPct" :show-text="false" :stroke-width="8" style="margin-top: 16px" />
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.gen-progress {
  text-align: center;
  padding: 8px 4px 4px;
}
.gen-ic {
  width: 52px;
  height: 52px;
  margin: 0 auto 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background: #eff4ff;
  color: #2563eb;
}
.gen-ic svg {
  width: 28px;
  height: 28px;
}
.gen-text {
  font-size: 13px;
  color: #334155;
}
.gen-sub {
  margin-top: 6px;
  font-size: 12px;
  color: #94a3b8;
}
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

/* 左侧筛选面板 */
.ws-fp {
  flex: 0 0 240px;
  min-width: 0;
  padding: 14px;
  background: #fff;
  border-right: 1px solid #eef2f7;
  overflow-y: auto;
}

.fp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  font-size: 14px;
  color: #0f172a;
}

.fp-head .cnt {
  font-size: 11px;
  color: #64748b;
  font-weight: 400;
}

.fp-batch {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.fp-batch button {
  flex: 1;
  height: 28px;
  border: 1px solid #e2e8f0;
  border-radius: 7px;
  background: #fff;
  color: #475569;
  font-size: 12px;
  cursor: pointer;
}

.fp-batch button:hover {
  border-color: #2563eb;
  color: #2563eb;
}

.fp-search input {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 12.5px;
  outline: none;
  box-sizing: border-box;
}

.fp-search input:focus {
  border-color: #2563eb;
}

.fp-group {
  margin-top: 16px;
}

.fp-title {
  font-size: 12px;
  font-weight: 700;
  color: #64748b;
  margin-bottom: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.fp-title .cnt {
  font-size: 11px;
  font-weight: 400;
  color: #94a3b8;
}

.fp-year {
  display: flex;
  align-items: center;
  gap: 6px;
}

.fp-year input {
  width: 100%;
  height: 30px;
  padding: 0 8px;
  border: 1px solid #e2e8f0;
  border-radius: 7px;
  font-size: 12.5px;
  outline: none;
  box-sizing: border-box;
}

.fp-year span {
  color: #94a3b8;
  font-size: 12px;
}

.fp-list {
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.fp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 7px;
  font-size: 13px;
  color: #334155;
  cursor: pointer;
}

.fp-item:hover {
  background: #f1f5f9;
}

.fp-item.on {
  background: #e9effd;
  color: #2563eb;
}

.fp-item input {
  accent-color: #2563eb;
}

.fp-src {
  font-size: 12.5px;
  color: #64748b;
  padding: 6px 8px;
  background: #f8fafc;
  border-radius: 7px;
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

/* ===== 图表视图 ===== */
.ws-chart-body {
  padding: 16px 20px 20px;
  gap: 16px;
}

.chart-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 2px;
}

.btn-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  color: #475569;
  font-size: 13px;
  cursor: pointer;
}

.btn-back:hover {
  border-color: #2563eb;
  color: #2563eb;
}

.chart-types {
  display: flex;
  gap: 4px;
  padding: 3px;
  background: #f1f5f9;
  border-radius: 9px;
}

.chart-types .ct {
  height: 26px;
  padding: 0 14px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #64748b;
  font-size: 12.5px;
  cursor: pointer;
}

.chart-types .ct.on {
  background: #fff;
  color: #2563eb;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
}

.chart-tools {
  display: flex;
  align-items: center;
  gap: 14px;
}

.chk {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  color: #475569;
  cursor: pointer;
}

.chk input {
  accent-color: #2563eb;
}

.chart-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chart-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid #eef2f7;
  border-radius: 12px;
  padding: 16px;
}

.chart-title {
  font-size: 14px;
  color: #0f172a;
  margin-bottom: 8px;
}

.chart-canvas {
  flex: 1;
  min-height: 0;
  width: 100%;
}

.chart-range {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: #fff;
  border: 1px solid #eef2f7;
  border-radius: 10px;
}

.chart-range .rl {
  font-size: 12px;
  color: #64748b;
  flex: 0 0 auto;
}

.chart-range input {
  flex: 1;
  accent-color: #2563eb;
}

.chart-range .rv {
  font-size: 12.5px;
  color: #2563eb;
  font-weight: 600;
  flex: 0 0 auto;
}

.chart-side {
  flex: 0 0 260px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}

.chart-side .card {
  background: #fff;
  border: 1px solid #eef2f7;
  border-radius: 12px;
  padding: 14px;
}

.chart-side .hd {
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 10px;
}

.legend {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: #334155;
}

.legend-item .sw {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex: 0 0 auto;
}

.legend-item .nm {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.legend-item b {
  color: #475569;
  font-weight: 600;
}

.trend {
  font-size: 12.5px;
  line-height: 1.9;
  color: #334155;
}

.rec-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rec {
  text-align: center;
  padding: 8px 0;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 12.5px;
  color: #475569;
  cursor: pointer;
}

.rec:hover {
  border-color: #2563eb;
  color: #2563eb;
}

.rec.on {
  background: #e9effd;
  border-color: #2563eb;
  color: #2563eb;
}

.empty-tip {
  font-size: 12.5px;
  color: #94a3b8;
}

/* ===== 上传弹窗 ===== */
.up-drop {
  border: 1.5px dashed #cbd5e1;
  border-radius: 10px;
  padding: 26px 16px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s;
}

.up-drop:hover {
  border-color: #2563eb;
  background: #f8faff;
}

.up-ic {
  color: #2563eb;
  width: 30px;
  height: 30px;
  margin: 0 auto 8px;
}

.up-t {
  font-size: 13.5px;
  color: #334155;
}

.up-s {
  margin-top: 4px;
  font-size: 12px;
  color: #94a3b8;
}

.up-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.up-file {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: #f8fafc;
  border-radius: 8px;
  font-size: 13px;
}

.up-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #334155;
}

.up-size {
  color: #94a3b8;
  font-size: 12px;
}

.link {
  color: #2563eb;
  cursor: pointer;
  font-size: 12.5px;
}

.up-note {
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.7;
  color: #94a3b8;
}
</style>
