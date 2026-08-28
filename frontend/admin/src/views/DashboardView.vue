<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import PageHead from '@/components/PageHead.vue';
import { fetchOverview } from '@/api/admin';
import type { AdminOverview } from '@/api/admin';

const router = useRouter();
const range = ref<'today' | '7d' | '30d'>('7d');
const loading = ref(false);
const data = ref<AdminOverview | null>(null);

const RANGE_OPTIONS: Array<{ key: 'today' | '7d' | '30d'; label: string }> = [
  { key: 'today', label: '今日' },
  { key: '7d', label: '近 7 日' },
  { key: '30d', label: '近 30 日' },
];

const RANGE_LABEL: Record<string, string> = { today: '今日', '7d': '近 7 日', '30d': '近 30 日' };

/** 千分位格式化 */
function fmt(n: number): string {
  return n.toLocaleString('zh-CN');
}

/** 收入（分）→ 元，保留两位小数 */
function fmtMoney(cents: number): string {
  return `¥${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 数值数组 → 百分比高度（最高 100%，空值保底 4% 可见） */
function barPct(values: number[]): number[] {
  const max = Math.max(...values, 1);
  return values.map((v) => Math.max(4, Math.round((v / max) * 100)));
}

async function load() {
  loading.value = true;
  try {
    data.value = await fetchOverview(range.value);
  } finally {
    loading.value = false;
  }
}

function switchRange(key: 'today' | '7d' | '30d') {
  range.value = key;
  void load();
}

let timer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  void load();
  timer = setInterval(() => void load(), 5 * 60 * 1000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div v-loading="loading" class="dashboard-page">
    <PageHead title="平台总览" desc="平台整体运行总览（PRD A-01）" :tags="['用户量', '检索量', '收入']" />

    <div class="toolbar">
      <button
        v-for="opt in RANGE_OPTIONS"
        :key="opt.key"
        class="range-btn"
        :class="{ active: range === opt.key }"
        @click="switchRange(opt.key)"
      >
        {{ opt.label }}
      </button>
      <span class="spacer"></span>
      <span class="muted">每 5 分钟自动刷新</span>
      <button class="refresh-btn" @click="load">刷新</button>
    </div>

    <div v-if="data" class="dash-body">
      <div class="kpi-grid">
        <div class="kpi">
          <div class="kpi-main">
            <div class="lbl">平台用户总量</div>
            <div class="val">{{ fmt(data.kpis.totalUsers) }}</div>
          </div>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" class="kpi-ic"><circle cx="9" cy="8" r="3.2" stroke="#409eff" stroke-width="1.8" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" stroke="#409eff" stroke-width="1.8" stroke-linecap="round" /></svg>
        </div>
        <div class="kpi">
          <div class="kpi-main">
            <div class="lbl">{{ RANGE_LABEL[range] }}新增用户</div>
            <div class="val">{{ fmt(data.kpis.newUsers) }}</div>
          </div>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" class="kpi-ic"><circle cx="12" cy="8" r="3.2" stroke="#409eff" stroke-width="1.8" /><path d="M5 19a7 7 0 0 1 14 0" stroke="#409eff" stroke-width="1.8" stroke-linecap="round" /></svg>
        </div>
        <div class="kpi">
          <div class="kpi-main">
            <div class="lbl">检索总量</div>
            <div class="val">{{ fmt(data.kpis.totalSearches) }}</div>
          </div>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" class="kpi-ic"><circle cx="10.5" cy="10.5" r="6.5" stroke="#409eff" stroke-width="1.8" /><path d="m16 16 4 4" stroke="#409eff" stroke-width="1.8" stroke-linecap="round" /></svg>
        </div>
        <div class="kpi">
          <div class="kpi-main">
            <div class="lbl">今日检索次数</div>
            <div class="val">{{ fmt(data.kpis.todaySearches) }}</div>
          </div>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" class="kpi-ic"><path d="M5 19c0-5 3-8 7-8s7 3 7 8" stroke="#409eff" stroke-width="1.8" stroke-linecap="round" /><path d="M12 3v2M5.5 6.5 7 8M18.5 6.5 17 8" stroke="#409eff" stroke-width="1.8" stroke-linecap="round" /></svg>
        </div>
        <div class="kpi">
          <div class="kpi-main">
            <div class="lbl">{{ RANGE_LABEL[range] }}收入</div>
            <div class="val">{{ fmtMoney(data.kpis.incomeCents) }}</div>
          </div>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" class="kpi-ic"><rect x="4" y="6" width="16" height="12" rx="2" stroke="#409eff" stroke-width="1.8" /><path d="M9 10h6" stroke="#409eff" stroke-width="1.8" stroke-linecap="round" /></svg>
        </div>
      </div>

      <div class="panel-grid">
        <div class="panel">
          <div class="panel-head"><h2>用户量趋势</h2><span class="sub">近 7 日 · 新增/活跃</span></div>
          <div class="panel-body">
            <div class="legend">
              <span><i class="dot dot-new"></i>新增用户</span>
              <span><i class="dot dot-active"></i>活跃用户</span>
            </div>
            <div class="mini-bar row-new">
              <i v-for="(h, i) in barPct(data.trends.newUsers)" :key="i" :style="{ height: h + '%' }" class="bar bar-new"></i>
            </div>
            <div class="mini-bar row-active">
              <i v-for="(h, i) in barPct(data.trends.activeUsers)" :key="i" :style="{ height: h + '%' }" class="bar bar-active"></i>
            </div>
            <div class="bar-labels">
              <span v-for="(d, i) in data.trends.days" :key="i">{{ d }}</span>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h2>检索量趋势</h2><span class="sub">近 7 日 · 检索次数</span></div>
          <div class="panel-body">
            <div class="mini-bar row-search">
              <i v-for="(h, i) in barPct(data.trends.searches)" :key="i" :style="{ height: h + '%' }" class="bar bar-search"></i>
            </div>
            <div class="bar-labels">
              <span v-for="(d, i) in data.trends.days" :key="i">{{ d }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="panel-grid">
        <div class="panel">
          <div class="panel-head"><h2>待办提醒</h2><span class="sub">运营看板</span></div>
          <div class="panel-body">
            <div class="item-list">
              <div class="item">
                <span class="dot-status warn"></span>
                <div class="item-text">
                  <strong>数据接入审核待办 {{ data.todos.importPending }} 项</strong>
                  <div class="small muted">含超 3 个工作日未处理（A-08）</div>
                </div>
                <button class="link" @click="router.push('/imports')">去处理</button>
              </div>
              <div class="item">
                <span class="dot-status"></span>
                <div class="item-text">
                  <strong>知识入库审核待办 {{ data.todos.kbReviewPending }} 项</strong>
                  <div class="small muted">自动入库内容待审核（A-16）</div>
                </div>
                <button class="link" @click="router.push('/kb/review')">去处理</button>
              </div>
              <div class="item">
                <span class="dot-status info"></span>
                <div class="item-text">
                  <strong>7 天内到期会员 {{ data.todos.expiringMembers }} 人</strong>
                  <div class="small muted">建议发起续费提醒（A-03）</div>
                </div>
                <button class="link" @click="router.push('/members')">去查看</button>
              </div>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h2>近 7 日运营概览</h2><span class="sub">汇总</span></div>
          <div class="panel-body">
            <table class="overview-table">
              <tbody>
                <tr><td>活跃用户</td><td class="num">{{ fmt(data.overview.activeUsers) }}</td></tr>
                <tr><td>人均检索次数</td><td class="num">{{ data.overview.avgSearches }}</td></tr>
                <tr><td>报告生成任务</td><td class="num">{{ fmt(data.overview.reportCount) }}</td></tr>
                <tr><td>新增知识条目</td><td class="num">{{ fmt(data.overview.newChunks) }}</td></tr>
              </tbody>
            </table>
            <div class="small muted mt12">统计数据源异常时展示最近一次成功数据并提示刷新失败。</div>
          </div>
        </div>
      </div>

      <div v-if="data.degraded" class="degraded-tip">部分统计数据源异常，已降级展示，请稍后刷新重试</div>
    </div>
  </div>
</template>

<style scoped>
.dashboard-page {
  min-height: 100%;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.range-btn,
.refresh-btn {
  padding: 5px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
  color: #475569;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.range-btn:hover,
.refresh-btn:hover {
  border-color: #409eff;
  color: #409eff;
}

.range-btn.active {
  background: #409eff;
  border-color: #409eff;
  color: #fff;
}

.spacer {
  flex: 1;
}

.muted {
  color: #94a3b8;
  font-size: 12px;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 16px;
  margin-bottom: 16px;
}

.kpi {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px;
  background: #fff;
  border: 1px solid #eef2f7;
  border-radius: 14px;
}

.kpi-main {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.lbl {
  font-size: 13px;
  color: #64748b;
}

.val {
  font-size: 24px;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: 0.3px;
}

.kpi-ic {
  color: #409eff;
}

.panel-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}

.panel {
  background: #fff;
  border: 1px solid #eef2f7;
  border-radius: 14px;
  overflow: hidden;
}

.panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 16px 20px 0;
}

.panel-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
}

.panel-head .sub {
  font-size: 12px;
  color: #94a3b8;
}

.panel-body {
  padding: 16px 20px 20px;
}

.legend {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
  font-size: 12px;
  color: #64748b;
}

.legend .dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  margin-right: 5px;
}

.dot-new,
.bar-new {
  background: #409eff;
}

.dot-active,
.bar-active {
  background: #a0cfff;
}

.dot-search,
.bar-search {
  background: #409eff;
}

.mini-bar {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 90px;
}

.mini-bar .bar {
  flex: 1;
  border-radius: 3px 3px 0 0;
  min-height: 4px;
}

.row-active {
  margin-top: 6px;
  height: 60px;
}

.bar-labels {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.bar-labels span {
  flex: 1;
  text-align: center;
  font-size: 11px;
  color: #94a3b8;
}

.item-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.dot-status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #67c23a;
  flex-shrink: 0;
}

.dot-status.warn {
  background: #e6a23c;
}

.dot-status.info {
  background: #409eff;
}

.item-text {
  flex: 1;
}

.item-text strong {
  font-size: 13px;
  color: #1e293b;
  font-weight: 600;
}

.small {
  font-size: 12px;
}

.muted {
  color: #94a3b8;
}

.item-text .small {
  margin-top: 3px;
}

.link {
  border: none;
  background: none;
  color: #409eff;
  font-size: 13px;
  cursor: pointer;
}

.overview-table {
  width: 100%;
  border-collapse: collapse;
}

.overview-table td {
  padding: 9px 0;
  font-size: 13px;
  color: #475569;
  border-bottom: 1px solid #f1f5f9;
}

.overview-table .num {
  text-align: right;
  color: #0f172a;
  font-weight: 600;
}

.mt12 {
  margin-top: 12px;
}

.degraded-tip {
  padding: 10px 14px;
  border-radius: 8px;
  background: #fdf6ec;
  color: #b88230;
  font-size: 13px;
}
</style>
