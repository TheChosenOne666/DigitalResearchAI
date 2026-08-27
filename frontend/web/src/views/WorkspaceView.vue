<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import TopNav from '@/components/TopNav.vue';
import { fetchDataset, type DatasetResult } from '@/api/workspace';

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
const years = computed(() => dataset.value?.years ?? []);
const series = computed(() => dataset.value?.indicators[0]?.series ?? []);

/** 已选国家计数（用于筛选面板） */
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
      countries: selectedCountries.value,
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

/** 指标名称 → 后端 series.country 的映射（后端按输入中文名回显） */
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
  selectedCountries.value = [...ALL_COUNTRIES];
  scheduleLoad();
}

function clearAll(): void {
  selectedCountries.value = [];
  dataset.value = null;
}

// ===== 底部操作：CSV 下载 =====

function downloadCsv(): void {
  if (!dataset.value || !rows.value.length) {
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

/** M4.2–M4.4 占位功能 */
function comingSoon(name: string): void {
  ElMessage.info(`「${name}」将在后续批次开放`);
}

onMounted(load);
watch(indicator, scheduleLoad);
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

    <div class="ws-body">
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
          <div class="fp-title">国家 / 地区 <span class="cnt">{{ selCount }}/{{ ALL_COUNTRIES.length }}</span></div>
          <div class="fp-list">
            <label
              v-for="c in ALL_COUNTRIES"
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
          <div class="fp-src">世界发展指标数据库（WDI）</div>
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
          <div v-if="!dataset || !rows.length" class="ws-empty">
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
                      <span class="m-item">数据来源<b>{{ dataset.source }}</b></span>
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
          <span>数据来源：{{ dataset?.source ?? '世界发展指标数据库（WDI）' }}</span>
          <span>行维度为国家/地区，列维度为年份</span>
        </div>

        <div class="ws-opbar">
          <span class="op" @click="downloadCsv">
            <svg class="ic" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
            下载 CSV
          </span>
          <span class="op primary" @click="comingSoon('生成数据图表')">
            <svg class="ic" viewBox="0 0 24 24" fill="none"><path d="M4 19V9m6 10V5m6 14v-7m4 7V3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
            生成数据图表
          </span>
          <span class="op primary" @click="comingSoon('生成分析结果')">
            <svg class="ic" viewBox="0 0 24 24" fill="none"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" /></svg>
            生成分析结果
          </span>
          <span class="op" @click="comingSoon('数据上传补充')">
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
</style>
