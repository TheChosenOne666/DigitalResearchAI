<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHead from '@/components/PageHead.vue';
import { ApiError } from '@/api/http';
import { fetchKbIndexStats, rebuildKbIndex, incrementKbIndex, cleanKbIndex } from '@/api/admin';
import type { KbIndexStats } from '@/api/admin';

const loading = ref(false);
const stats = ref<KbIndexStats | null>(null);
const strategy = ref('AUTO_DAILY');
const acting = ref(false);

async function load() {
  loading.value = true;
  try {
    stats.value = await fetchKbIndexStats();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '加载失败');
  } finally {
    loading.value = false;
  }
}

function fmtTime(v: string | null) {
  if (!v) return '—';
  return new Date(v).toLocaleString('zh-CN', { hour12: false });
}

const ACTION_LABEL: Record<string, string> = { REBUILD: '索引重建', INCREMENT: '增量更新', CLEAN: '脏数据清理' };
const TASK_STATUS_LABEL: Record<string, string> = { WAITING: '待执行', RUNNING: '执行中', SUCCESS: '成功', FAILED: '失败 · 可重试', STOPPED: '已终止' };
const TASK_STATUS_TAG: Record<string, 'info' | 'warning' | 'success' | 'danger'> = { WAITING: 'info', RUNNING: 'warning', SUCCESS: 'success', FAILED: 'danger', STOPPED: 'info' };

async function withConfirm(title: string, message: string, run: () => Promise<unknown>) {
  try {
    await ElMessageBox.confirm(message, title, { type: 'warning', confirmButtonText: '确认执行', cancelButtonText: '取消' });
  } catch {
    return;
  }
  acting.value = true;
  try {
    await run();
    ElMessage.success('任务已登记，可进入任务中心（A-11）监控进度');
    void load();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '操作失败');
  } finally {
    acting.value = false;
  }
}

function onRebuild() {
  void withConfirm('发起索引重建', '算法/模型升级后执行全量重建；执行期间检索继续使用现有索引，不中断检索服务。演示环境仅登记任务记录。', () => rebuildKbIndex());
}

function onIncrement() {
  void withConfirm('手动增量更新', `按当前策略（${strategy.value === 'AUTO_DAILY' ? '入库自动更新 + 每日定时校验' : '仅每日定时校验'}）登记一次增量更新任务。`, () => incrementKbIndex(strategy.value));
}

function onClean() {
  void withConfirm('执行脏数据清理', '清理失效、重复、被删除条目的残留索引数据；清理前自动备份索引配置。演示环境仅登记任务记录。', () => cleanKbIndex());
}

onMounted(() => void load());
</script>

<template>
  <div class="kb-index-page">
    <PageHead title="向量索引维护" desc="维护向量索引，保障检索效率（PRD A-19）" :tags="['索引重建', '增量更新', '脏数据清理']" />

    <div v-loading="loading" class="kpis mb16">
      <div class="kpi">
        <span class="k-num">{{ stats ? stats.totalDocs.toLocaleString() : '—' }}</span>
        <span class="k-label">索引条目总数</span>
      </div>
      <div class="kpi">
        <span class="k-num">{{ stats ? stats.pendingChunks.toLocaleString() : '—' }}</span>
        <span class="k-label">待增量更新（未向量化切片）</span>
      </div>
      <div class="kpi">
        <span class="k-num">{{ fmtTime(stats?.lastRebuildAt ?? null) }}</span>
        <span class="k-label">上次重建时间</span>
      </div>
    </div>

    <div class="grid mb16">
      <div class="panel">
        <div class="panel-head"><h2>索引重建（全量）</h2></div>
        <div class="panel-body">
          <p class="desc">算法/模型升级后执行全量重建；执行期间检索继续使用现有索引，重建完成后原子切换，不中断检索服务。</p>
          <el-button type="primary" :loading="acting" @click="onRebuild">发起重建</el-button>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>增量更新（自动 + 手动）</h2></div>
        <div class="panel-body">
          <el-select v-model="strategy" class="w280 mb12">
            <el-option label="入库自动更新 + 每日定时校验" value="AUTO_DAILY" />
            <el-option label="仅每日定时校验" value="DAILY_ONLY" />
          </el-select>
          <el-button :loading="acting" @click="onIncrement">手动更新</el-button>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>脏数据清理</h2></div>
        <div class="panel-body">
          <p class="desc">清理失效、重复、被删除条目的残留索引数据；清理前自动备份索引配置。</p>
          <el-button :loading="acting" @click="onClean">执行清理</el-button>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>索引任务记录</h2><span class="sub">进入任务中心（A-11）监控 · 失败可重试</span></div>
      <div class="panel-body">
        <el-table v-loading="loading" :data="stats?.recentTasks ?? []" style="width: 100%">
          <el-table-column label="任务" width="200">
            <template #default="{ row }"><span class="cell-strong">{{ row.taskNo }}</span></template>
          </el-table-column>
          <el-table-column label="类型" width="120">
            <template #default="{ row }">
              <el-tag type="primary" effect="light" size="small">{{ ACTION_LABEL[row.action ?? ''] ?? row.action ?? '索引任务' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="时间" width="180">
            <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="140">
            <template #default="{ row }">
              <el-tag :type="TASK_STATUS_TAG[row.status] ?? 'info'" effect="light" size="small">{{ TASK_STATUS_LABEL[row.status] ?? row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作">
            <template #default>
              <span class="small muted">重试/详情请前往「任务中心」</span>
            </template>
          </el-table-column>
          <template #empty><div class="empty-state">暂无索引任务记录</div></template>
        </el-table>
        <div class="note">演示环境未执行真实操作：索引任务仅落任务记录（D5），不影响现有 Qdrant 索引与检索服务。</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.kpi { background: #fff; border: 1px solid #eef2f7; border-radius: 14px; padding: 18px 20px; display: flex; flex-direction: column; gap: 6px; }
.k-num { font-size: 24px; font-weight: 700; color: #1e293b; }
.k-label { font-size: 12.5px; color: #94a3b8; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.panel { background: #fff; border: 1px solid #eef2f7; border-radius: 14px; overflow: hidden; margin-bottom: 16px; }
.panel-head { display: flex; align-items: baseline; gap: 10px; padding: 14px 20px 0; }
.panel-head h2 { font-size: 15px; font-weight: 600; color: #1e293b; margin: 0; }
.panel-head .sub { font-size: 12px; color: #94a3b8; }
.panel-body { padding: 14px 20px 20px; }
.mb16 { margin-bottom: 16px; }
.mb12 { margin-bottom: 12px; }
.w280 { width: 280px; }
.desc { font-size: 13px; color: #475569; line-height: 1.7; margin: 0 0 12px; }
.cell-strong { font-weight: 600; color: #1e293b; }
.muted { color: #94a3b8; }
.small { font-size: 12px; color: #475569; }
.note { margin-top: 12px; font-size: 12px; color: #94a3b8; }
.empty-state { padding: 32px 0; color: #94a3b8; font-size: 13px; }
</style>
