<script setup lang="ts">
import { ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  abortSearchTask,
  deleteSearchTask,
  listSearchTasks,
  type SearchTaskItem,
  type SearchTaskStatus,
} from '@/api/search';

/**
 * 智搜任务面板（18 批 4 任务管控）：
 * 展示本人检索/生成任务的状态与进度，支持中止、继续生成、打开报告、删除。
 * 需要页面联动的动作（续跑/打开/恢复选择态）通过事件交给父组件。
 */

const visible = defineModel<boolean>('visible', { required: true });
defineProps<{
  /** 正在续跑的任务 id（用于禁用重复点击） */
  resumingId?: string;
}>();
const emit = defineEmits<{
  /** 继续生成（父组件发起 SSE 续跑，需带 sessionId 以恢复来源展示） */
  resume: [taskId: string, sessionId: string];
  /** 打开已完成任务的报告 */
  open: [sessionId: string];
  /** 恢复「待选择」会话的选数据态 */
  select: [sessionId: string];
  /** 续跑窗口已过期：带原问题请求父组件重新检索 */
  research: [question: string];
}>();

const loading = ref(false);
const items = ref<SearchTaskItem[]>([]);
const filter = ref<'all' | 'active' | 'done' | 'failed'>('all');

const FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '进行中' },
  { value: 'done', label: '已完成' },
  { value: 'failed', label: '失败' },
] as const;

/** 拉取任务列表 */
async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await listSearchTasks({
      status: filter.value === 'all' ? undefined : filter.value,
      pageSize: 50,
    });
    items.value = res.items ?? [];
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '任务列表加载失败');
  } finally {
    loading.value = false;
  }
}

/** 打开面板或切换筛选时刷新 */
watch(
  [visible, filter],
  () => {
    if (visible.value) void load();
  },
  { immediate: true },
);

/** 状态文案 */
function statusText(s: SearchTaskStatus): string {
  const map: Record<SearchTaskStatus, string> = {
    RETRIEVING: '检索中',
    PENDING_SELECT: '待选择数据',
    GENERATING: '生成中',
    DONE: '已完成',
    RETRIEVAL_FAILED: '检索失败',
    GENERATE_FAILED: '生成中断',
    ABORTED: '已中止',
  };
  return map[s] ?? s;
}

/** 状态样式类（成功/进行中/失败/等待） */
function statusClass(s: SearchTaskStatus): string {
  if (s === 'DONE') return 'st-done';
  if (s === 'RETRIEVAL_FAILED' || s === 'GENERATE_FAILED' || s === 'ABORTED') return 'st-failed';
  if (s === 'PENDING_SELECT') return 'st-wait';
  return 'st-active';
}

const isActive = (t: SearchTaskItem): boolean =>
  t.status === 'RETRIEVING' || t.status === 'GENERATING';
/** 生成类任务中断后才可续跑 */
const canResume = (t: SearchTaskItem): boolean =>
  t.type === 'generate' && (t.status === 'GENERATE_FAILED' || t.status === 'ABORTED');
/** 续跑需复用检索快照：快照过期后只能重新检索（列表接口按快照有效期折算） */
const resumeExpired = (t: SearchTaskItem): boolean => canResume(t) && (t.resumableSeconds ?? 0) <= 0;

/** 续跑窗口提示文案（过期时引导重新勾选后开始分析） */
function resumeHint(t: SearchTaskItem): string {
  const s = t.resumableSeconds ?? 0;
  if (s <= 0) return '检索结果已过期，请重新勾选并点击开始分析';
  return `可在 ${Math.max(1, Math.ceil(s / 60))} 分钟内继续生成`;
}

/** 时间展示（相对时间） */
function timeText(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return d.toLocaleString();
}

/** 中止进行中的任务 */
async function onAbort(t: SearchTaskItem): Promise<void> {
  try {
    await abortSearchTask(t.id);
    ElMessage.success('已请求中止，将在当前章节结束后停止');
    void load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '中止失败');
  }
}

/** 删除任务记录 */
async function onRemove(t: SearchTaskItem): Promise<void> {
  try {
    await ElMessageBox.confirm('删除任务记录？已生成的报告仍保留在「我的报告」。', '删除任务', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
  } catch {
    return; // 用户取消
  }
  try {
    await deleteSearchTask(t.id);
    ElMessage.success('任务记录已删除');
    void load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败');
  }
}
</script>

<template>
  <el-drawer v-model="visible" title="任务中心" size="440px" class="task-drawer">
    <div class="task-filters">
      <button
        v-for="f in FILTERS"
        :key="f.value"
        class="task-filter"
        :class="{ on: filter === f.value }"
        @click="filter = f.value"
      >
        {{ f.label }}
      </button>
      <button class="task-refresh" title="刷新" @click="load">刷新</button>
    </div>

    <div v-loading="loading" class="task-list">
      <p v-if="!loading && !items.length" class="task-empty">
        暂无任务。发起一次智搜后，这里会记录检索与生成的状态。
      </p>

      <div v-for="t in items" :key="t.id" class="task-item">
        <div class="task-head">
          <span class="task-type">{{ t.type === 'retrieval' ? '检索' : '生成' }}</span>
          <span class="task-status" :class="statusClass(t.status)">{{ statusText(t.status) }}</span>
          <span class="task-time">{{ timeText(t.createdAt) }}</span>
        </div>
        <div class="task-q" :title="t.question">{{ t.question || '（无问题记录）' }}</div>
        <div v-if="isActive(t)" class="task-bar">
          <i :style="{ width: `${t.progress}%` }" />
          <span>{{ t.progress }}%</span>
        </div>
        <div v-if="t.errorMsg" class="task-err">{{ t.errorMsg }}</div>
        <div v-if="canResume(t)" class="task-hint" :class="{ warn: resumeExpired(t) }">
          {{ resumeHint(t) }}
        </div>
        <div class="task-actions">
          <button v-if="isActive(t)" class="ta danger" @click="onAbort(t)">中止</button>
          <button
            v-if="canResume(t) && !resumeExpired(t)"
            class="ta primary"
            :disabled="resumingId === t.id"
            @click="emit('resume', t.id, t.sessionId)"
          >
            {{ resumingId === t.id ? '续跑中…' : '继续生成' }}
          </button>
          <button
            v-if="resumeExpired(t)"
            class="ta primary"
            @click="emit('research', t.question)"
          >
            重新检索
          </button>
          <button v-if="t.status === 'DONE'" class="ta" @click="emit('open', t.sessionId)">
            查看报告
          </button>
          <button
            v-if="t.status === 'PENDING_SELECT'"
            class="ta"
            @click="emit('select', t.sessionId)"
          >
            去选数据
          </button>
          <button class="ta ghost" @click="onRemove(t)">删除</button>
        </div>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
.task-filters {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}

.task-filter {
  height: 28px;
  padding: 0 12px;
  border: 1px solid #dbe2ea;
  border-radius: 999px;
  background: #fff;
  color: #475569;
  font-size: 12.5px;
  cursor: pointer;
}

.task-filter.on {
  border-color: #2563eb;
  background: #eff4fe;
  color: #1d4ed8;
  font-weight: 600;
}

.task-refresh {
  margin-left: auto;
  height: 28px;
  padding: 0 10px;
  border: 1px solid #dbe2ea;
  border-radius: 8px;
  background: #fff;
  color: #475569;
  font-size: 12.5px;
  cursor: pointer;
}

.task-list {
  min-height: 120px;
}

.task-empty {
  padding: 24px 8px;
  color: #94a3b8;
  font-size: 13px;
  text-align: center;
}

.task-item {
  padding: 10px 12px;
  margin-bottom: 10px;
  border: 1px solid #e6ebf1;
  border-radius: 10px;
  background: #fff;
}

.task-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.task-type {
  padding: 1px 6px;
  border-radius: 4px;
  background: #f1f5f9;
  color: #475569;
}

.task-status {
  font-weight: 600;
}

.st-active {
  color: #1d4ed8;
}

.st-done {
  color: #16a34a;
}

.st-failed {
  color: #dc2626;
}

.st-wait {
  color: #b45309;
}

.task-time {
  margin-left: auto;
  color: #94a3b8;
}

.task-q {
  margin: 6px 0 4px;
  color: #0f172a;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-bar {
  position: relative;
  height: 6px;
  margin: 6px 0;
  border-radius: 999px;
  background: #eef2f7;
}

.task-bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #60a5fa, #2563eb);
  transition: width 0.3s;
}

.task-bar span {
  position: absolute;
  right: 0;
  top: -16px;
  color: #64748b;
  font-size: 11px;
}

.task-err {
  margin: 4px 0;
  color: #b91c1c;
  font-size: 12px;
}

/* 续跑窗口提示（过期时转为警示色） */
.task-hint {
  margin: 4px 0;
  color: #64748b;
  font-size: 12px;
}

.task-hint.warn {
  color: #b45309;
}

.task-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.ta {
  height: 28px;
  padding: 0 12px;
  border: 1px solid #dbe2ea;
  border-radius: 8px;
  background: #fff;
  color: #334155;
  font-size: 12.5px;
  cursor: pointer;
}

.ta.primary {
  border-color: #2563eb;
  background: #2563eb;
  color: #fff;
  font-weight: 600;
}

.ta.primary:disabled {
  opacity: 0.6;
  cursor: progress;
}

.ta.danger {
  border-color: #fecaca;
  color: #b91c1c;
}

.ta.ghost {
  margin-left: auto;
  color: #94a3b8;
}
</style>
