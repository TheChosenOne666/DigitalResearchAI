<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { UploadRequestOptions } from 'element-plus';
import {
  listGroups,
  createGroup,
  listDocuments,
  uploadDocument,
  relearnDocument,
  deleteDocument,
  type KbDocumentItem,
  type KbGroup,
  type KbLibrary,
} from '@/api/kb';
import DocDetailDrawer from './DocDetailDrawer.vue';
import { STATUS_FILTER, STATUS_META, fmtSize, fmtTime } from './kb-meta';

/** 知识文档面板：分组栏 + 文档列表（上传/重新学习/删除/详情），数据自持按库加载 */

const props = defineProps<{ current: KbLibrary }>();

const detailDrawerRef = ref<InstanceType<typeof DocDetailDrawer> | null>(null);

const groups = ref<KbGroup[]>([]);
const docs = ref<KbDocumentItem[]>([]);
const docsLoading = ref(false);
const total = ref(0);
const filter = reactive<{ groupId: string; status: string }>({ groupId: '', status: '' });
/** 名称搜索（前端过滤） */
const keyword = ref('');

async function refreshGroups(): Promise<void> {
  try {
    groups.value = await listGroups(props.current.id);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '分组加载失败');
  }
}

const filteredDocs = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return docs.value;
  return docs.value.filter((d) => d.name.toLowerCase().includes(kw));
});

async function fetchDocs(): Promise<void> {
  docsLoading.value = true;
  try {
    const data = await listDocuments(
      props.current.id,
      { groupId: filter.groupId || undefined, status: filter.status || undefined },
      1,
      50,
    );
    docs.value = data.items;
    total.value = data.total;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '文档加载失败');
  } finally {
    docsLoading.value = false;
  }
}

/** 刷新文档列表，并按需启停学习中状态的轮询 */
async function refreshDocs(): Promise<void> {
  await fetchDocs();
  const hasLearning = docs.value.some((d) => d.status === 'LEARNING');
  if (hasLearning && pollTimer == null) {
    pollTimer = window.setInterval(() => {
      void refreshDocs();
    }, 4000);
  } else if (!hasLearning && pollTimer != null) {
    stopPolling();
  }
}

/** 学习中有未完成任务时轮询刷新状态 */
let pollTimer: number | null = null;

function stopPolling(): void {
  if (pollTimer != null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function newGroup(): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt('输入分组名称', '新建分组', {
      inputPattern: /\S+/,
      inputErrorMessage: '名称不能为空',
      confirmButtonText: '创建',
      cancelButtonText: '取消',
    });
    await createGroup(props.current.id, value.trim());
    ElMessage.success('分组已创建');
    await refreshGroups();
  } catch {
    /* 取消或失败不处理 */
  }
}

const uploading = ref(false);

async function handleUpload(options: UploadRequestOptions): Promise<unknown> {
  uploading.value = true;
  try {
    const r = await uploadDocument(props.current.id, options.file, filter.groupId || undefined);
    ElMessage.success(r.status === 'LEARNING' ? '上传成功，开始学习' : '上传成功，等待学习');
    await refreshDocs();
    return r;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '上传失败');
    return Promise.reject(e);
  } finally {
    uploading.value = false;
  }
}

async function relearnDoc(doc: KbDocumentItem): Promise<void> {
  try {
    await relearnDocument(props.current.id, doc.id);
    ElMessage.success('已重新提交学习');
    await refreshDocs();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '重新学习失败');
  }
}

async function removeDoc(doc: KbDocumentItem): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除文档「${doc.name}」？切片与向量将一并清理`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await deleteDocument(doc.id);
    ElMessage.success('文档已删除');
    await refreshDocs();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败');
  }
}

function openDetail(doc: KbDocumentItem): void {
  void detailDrawerRef.value?.open(doc);
}

onMounted(() => {
  void refreshGroups();
  void refreshDocs();
});

onBeforeUnmount(stopPolling);
</script>

<template>
  <div class="doc-layout">
    <aside class="groups-bar">
      <div class="groups-head">
        <span>知识分组</span>
        <el-button link type="primary" size="small" @click="newGroup">＋</el-button>
      </div>
      <div
        class="group-item"
        :class="{ active: !filter.groupId }"
        @click="((filter.groupId = ''), refreshDocs())"
      >
        全部 <span class="cnt">{{ current.docCount }}</span>
      </div>
      <div
        v-for="g in groups"
        :key="g.id"
        class="group-item"
        :class="{ active: filter.groupId === g.id }"
        @click="((filter.groupId = g.id), refreshDocs())"
      >
        {{ g.name }} <span class="cnt">{{ g.docCount }}</span>
      </div>
    </aside>

    <div class="doc-main">
      <div class="doc-toolbar">
        <el-select
          v-model="filter.status"
          placeholder="全部状态"
          clearable
          size="small"
          style="width: 130px"
          @change="refreshDocs()"
        >
          <el-option
            v-for="opt in STATUS_FILTER"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
        <el-input
          v-model="keyword"
          placeholder="搜索文档名称"
          size="small"
          clearable
          style="width: 220px"
        />
        <span class="spacer" />
        <el-upload
          :show-file-list="false"
          :http-request="handleUpload"
          accept=".xlsx,.xls,.csv,.docx,.doc,.pdf,.txt,.md"
          :disabled="uploading"
        >
          <el-button type="primary" size="small" :loading="uploading">＋ 上传文档</el-button>
        </el-upload>
      </div>

      <div class="doc-alert">
        文档学习状态为「学习完成 / 学习失败 / 学习中断」，学习中断可点击继续学习；
        学习完成后参与 AI 智搜的知识库优先检索。
      </div>

      <div class="doc-table" v-loading="docsLoading">
        <el-empty v-if="!filteredDocs.length" description="暂无文档，先上传或从智搜存入" />
        <table v-else>
          <thead>
            <tr>
              <th>名称</th>
              <th style="width: 90px">大小</th>
              <th style="width: 70px">切片数</th>
              <th style="width: 100px">状态</th>
              <th style="width: 160px">时间</th>
              <th style="width: 190px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in filteredDocs" :key="d.id">
              <td>
                <div class="doc-name" :title="d.name">{{ d.name }}</div>
                <div v-if="(d.tags?.length ?? 0) > 0" class="doc-tags">
                  <el-tag v-for="t in d.tags" :key="t" size="small" type="info">{{ t }}</el-tag>
                </div>
              </td>
              <td>{{ fmtSize(d.size) }}</td>
              <td>{{ d.chunkCount }}</td>
              <td>
                <el-tooltip
                  :disabled="!d.failReason"
                  :content="d.failReason ?? ''"
                  placement="top"
                >
                  <el-tag :type="STATUS_META[d.status].type" size="small">
                    {{ STATUS_META[d.status].label }}
                  </el-tag>
                </el-tooltip>
              </td>
              <td class="muted">{{ fmtTime(d.createdAt) }}</td>
              <td>
                <el-button link type="primary" size="small" @click="openDetail(d)">详情</el-button>
                <el-button
                  v-if="d.status === 'FAILED' || d.status === 'INTERRUPTED'"
                  link
                  type="warning"
                  size="small"
                  @click="relearnDoc(d)"
                >
                  重新学习
                </el-button>
                <el-button link type="danger" size="small" @click="removeDoc(d)">删除</el-button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <DocDetailDrawer ref="detailDrawerRef" />
  </div>
</template>

<style scoped>
.spacer {
  flex: 1;
}

.muted {
  color: #94a3b8;
  font-size: 12px;
}

.doc-layout {
  display: flex;
  min-height: 100%;
}

.groups-bar {
  width: 190px;
  flex: 0 0 auto;
  border-right: 1px solid #eef2f7;
  padding: 16px 10px;
}

.groups-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 8px;
  font-size: 13px;
  font-weight: 600;
  color: #334155;
}

.group-item {
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 13px;
  color: #475569;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.group-item:hover {
  background: #f1f5f9;
}

.group-item.active {
  background: #e9effd;
  color: #2563eb;
  font-weight: 600;
}

.group-item .cnt {
  font-size: 11px;
  color: #94a3b8;
}

.doc-main {
  flex: 1;
  min-width: 0;
  padding: 16px 20px;
}

.doc-toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
}

.doc-alert {
  margin: 12px 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: #f8fafc;
  border: 1px dashed #e2e8f0;
  font-size: 12px;
  color: #64748b;
  line-height: 1.7;
}

.doc-table table {
  width: 100%;
  border-collapse: collapse;
}

.doc-table th {
  text-align: left;
  font-size: 12px;
  color: #94a3b8;
  font-weight: 500;
  padding: 8px 10px;
  border-bottom: 1px solid #eef2f7;
}

.doc-table td {
  padding: 10px;
  font-size: 13px;
  color: #334155;
  border-bottom: 1px solid #f5f8fc;
  vertical-align: top;
}

.doc-name {
  font-weight: 600;
  color: #1e293b;
  word-break: break-all;
  max-width: 320px;
}

.doc-tags {
  margin-top: 4px;
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
</style>
