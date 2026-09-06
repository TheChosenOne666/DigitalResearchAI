<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import * as echarts from 'echarts';
import type { DatasetSeries } from '@/api/workspace';
import { CHART_COLORS, CHART_TYPE_NAME, formatIndicatorValue, type ChartType, type IndicatorMeta } from './constants';

/** 工作台图表视图面板：图表类型切换 / 区间滑块 / 图例与走势研判 / PNG·SVG 导出（echarts 实例由本组件私有） */

const props = defineProps<{
  /** 当前指标元信息（标题与数值格式化） */
  indicatorMeta: IndicatorMeta | undefined;
  /** 图表渲染的国家序列（父组件按选中实体过滤） */
  countries: DatasetSeries[];
  /** 合并后的年份列表（升序） */
  years: string[];
}>();

const chartType = defineModel<ChartType>('chartType', { required: true });
const chartLbl = defineModel<boolean>('chartLbl', { required: true });
const chartGrid = defineModel<boolean>('chartGrid', { required: true });
const chartFrom = defineModel<number>('chartFrom', { required: true });

const emit = defineEmits<{ back: [] }>();

const chartEl = ref<HTMLElement>();
let chart: echarts.ECharts | undefined;

const minYear = computed(() => (props.years.length ? Number(props.years[0]) : chartFrom.value));
const maxYear = computed(() => (props.years.length ? Number(props.years[props.years.length - 1]) : chartFrom.value));

/** 图表可见年份（区间滑块起点之后） */
const visibleYears = computed(() => props.years.filter((y) => Number(y) >= chartFrom.value));

/** 雷达图取代表性年份：区间内最多 3 个（首/中/尾） */
function pickRadarYears(ys: string[]): string[] {
  if (ys.length <= 3) return ys;
  return [ys[0], ys[Math.floor(ys.length / 2)], ys[ys.length - 1]];
}

/** 雷达图坐标轴最大值（区间内全部国家×年份的最大值） */
function radarMax(ys: string[]): number {
  let m = 0;
  for (const c of props.countries) {
    for (const y of ys) {
      const v = c.values[y];
      if (v != null && v > m) m = v;
    }
  }
  return m || 1;
}

function buildOption(): echarts.EChartsOption | null {
  const ys = visibleYears.value;
  const cs = props.countries;
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
  if (!chart) return;
  const opt = buildOption();
  chart.clear();
  if (opt) chart.setOption(opt, true);
}

onMounted(async () => {
  await nextTick();
  if (chartEl.value && !chart) {
    chart = echarts.init(chartEl.value);
  }
  chart?.resize();
  renderChart();
});

onBeforeUnmount(() => {
  chart?.dispose();
  chart = undefined;
});

watch([chartType, chartLbl, chartGrid, chartFrom, () => props.countries, visibleYears], () => {
  renderChart();
});

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
  props.countries.map((c, i) => ({
    name: c.country,
    color: CHART_COLORS[i % CHART_COLORS.length],
    latest: c.values[maxYear.value] ?? null,
  })),
);

/** 长周期走势研判（简明文案） */
const trendText = computed(() => {
  const cs = props.countries;
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
  return `${top.country} 在 ${chartFrom.value}-${last} 区间整体呈${dir}趋势，最新值 ${e == null ? '..' : formatIndicatorValue(e, props.indicatorMeta)}；建议结合产业政策与库存周期做多周期交叉验证。`;
});
</script>

<template>
  <div class="ws-body ws-chart-body">
    <div class="chart-head">
      <button class="btn-back" @click="emit('back')">
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

    <!-- 内容区：图表主区 + 右侧栏并排（工具条整行在其上方） -->
    <div class="chart-content">
      <div class="chart-main">
        <div class="chart-card">
          <div class="chart-title">
            <b v-if="indicatorMeta">{{ indicatorMeta.name }} · {{ chartFrom }}-{{ maxYear }} 可视化</b>
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
              <b>{{ it.latest == null ? '..' : formatIndicatorValue(it.latest, indicatorMeta) }}</b>
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
  </div>
</template>

<style scoped>
.flex-1 {
  flex: 1;
}

.ws-chart-body {
  /* 覆盖 .ws-body 的横向排列：工具条整行在上，内容区（图表主区 + 侧栏）在下；
     border-box 防止 padding 把 width:100% 撑出横向滚动条 */
  box-sizing: border-box;
  flex-direction: column;
  padding: 16px 20px 20px;
  gap: 16px;
}

.chart-content {
  flex: 1;
  min-height: 0;
  display: flex;
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

.ic {
  width: 15px;
  height: 15px;
}
</style>
