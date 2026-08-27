<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { UploadRequestOptions } from 'element-plus';
import {
  listLibraries,
  createLibrary,
  updateLibrary,
  deleteLibrary,
  listGroups,
  createGroup,
  listDocuments,
  getDocument,
  uploadDocument,
  relearnDocument,
  deleteDocument,
  recallTest,
  type KbLibrary,
  type KbGroup,
  type KbDocumentItem,
  type KbDocumentDetail,
  type KbDocStatus,
  type RecallTestResult,
} from '@/api/kb';

const router = useRouter();

// ===== 页面级状态 =====

/** 库卡片封面色可选值 */
const COLORS = ['#2563EB', '#059669', '#D97706', '#DC2626', '#7C3AED', '#16675F'];

/** 学习状态徽标映射 */
const STATUS_META: Record<KbDocStatus, { label: string; type: 'info' | 'primary' | 'success' | 'danger' | 'warning' }> = {
  PENDING: { label: '待审核', type: 'info' },
  LEARNING: { label: '学习中', type: 'primary' },
  READY: { label: '学习完成', type: 'success' },
  FAILED: { label: '学习失败', type: 'danger' },
  INTERRUPTED: { label: '学习中断', type: 'warning' },
};

const libs = ref<KbLibrary[]>([]);
const libsLoading = ref(false);
/** 当前进入的库（null = 列表态） */
const current = ref<KbLibrary | null>(null);

/** 左侧菜单：doc 文档 / config 配置 / recall 召回测试 */
const menu = ref<'doc' | 'config' | 'recall'>('doc');

// ===== 库列表 =====

async function refreshLibs(): Promise<void> {
  libsLoading.value = true;
  try {
    libs.value = await listLibraries();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '知识库加载失败');
  } finally {
    libsLoading.value = false;
  }
}
refreshLibs();

function openLibrary(lib: KbLibrary): void {
  current.value = { ...lib };
  menu.value = 'doc';
  filter.groupId = '';
  filter.status = '';
  keyword.value = '';
  void refreshGroups();
  void refreshDocs();
}

function backToList(): void {
  stopPolling();
  current.value = null;
  void refreshLibs();
}

/** 切到配置面板（先按当前库回填表单） */
function openConfig(): void {
  fillConfigForm();
  menu.value = 'config';
}

// ===== 新建知识库 =====

const createVisible = ref(false);
const creating = ref(false);
const createForm = reactive({ name: '', visibility: 'PRIVATE', color: COLORS[0], description: '' });

async function submitCreate(): Promise<void> {
  if (!createForm.name.trim()) {
    ElMessage.warning('请输入知识库名称');
    return;
  }
  creating.value = true;
  try {
    await createLibrary({
      name: createForm.name.trim(),
      visibility: createForm.visibility,
      color: createForm.color,
      description: createForm.description.trim() || null,
    });
    ElMessage.success(`已创建知识库「${createForm.name.trim()}」`);
    createVisible.value = false;
    createForm.name = '';
    createForm.description = '';
    await refreshLibs();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '创建失败');
  } finally {
    creating.value = false;
  }
}

// ===== 文档面板（分组 + 列表）=====

const groups = ref<KbGroup[]>([]);
const docs = ref<KbDocumentItem[]>([]);
const docsLoading = ref(false);
const total = ref(0);
const filter = reactive<{ groupId: string; status: string }>({ groupId: '', status: '' });
/** 名称搜索（前端过滤） */
const keyword = ref('');

async function refreshGroups(): Promise<void> {
  if (!current.value) return;
  try {
    groups.value = await listGroups(current.value.id);
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
  if (!current.value) return;
  docsLoading.value = true;
  try {
    const data = await listDocuments(
      current.value.id,
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
  if (!current.value) return;
  try {
    const { value } = await ElMessageBox.prompt('输入分组名称', '新建分组', {
      inputPattern: /\S+/,
      inputErrorMessage: '名称不能为空',
      confirmButtonText: '创建',
      cancelButtonText: '取消',
    });
    await createGroup(current.value.id, value.trim());
    ElMessage.success('分组已创建');
    await refreshGroups();
  } catch {
    /* 取消或失败不处理 */
  }
}

const uploading = ref(false);

async function handleUpload(options: UploadRequestOptions): Promise<unknown> {
  if (!current.value) return Promise.reject(new Error('未选择知识库'));
  uploading.value = true;
  try {
    const r = await uploadDocument(current.value.id, options.file, filter.groupId || undefined);
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
  if (!current.value) return;
  try {
    await relearnDocument(current.value.id, doc.id);
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

/** 文档详情抽屉 */
const drawerVisible = ref(false);
const drawerLoading = ref(false);
const drawerDoc = ref<KbDocumentDetail | null>(null);

async function openDetail(doc: KbDocumentItem): Promise<void> {
  drawerVisible.value = true;
  drawerLoading.value = true;
  try {
    drawerDoc.value = await getDocument(doc.id);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '文档详情加载失败');
  } finally {
    drawerLoading.value = false;
  }
}

// ===== 知识库配置 =====

const configSaving = ref(false);
const configForm = reactive({
  name: '',
  visibility: 'PRIVATE',
  description: '',
  chunkMode: 'FIXED' as 'FIXED' | 'SMART',
  chunkSize: 800,
  chunkOverlap: 80,
  embedModel: 'doubao-embedding-large',
  topK: 10,
  threshold: 0.4,
  weight: 1.2,
});

function fillConfigForm(): void {
  const c = current.value;
  if (!c) return;
  configForm.name = c.name;
  configForm.visibility = c.visibility;
  configForm.description = c.description ?? '';
  configForm.chunkMode = c.chunkMode;
  configForm.chunkSize = c.chunkSize;
  configForm.chunkOverlap = c.chunkOverlap;
  configForm.embedModel = c.embedModel;
  configForm.topK = c.topK;
  configForm.threshold = c.threshold;
  configForm.weight = c.weight;
}

async function saveConfig(): Promise<void> {
  if (!current.value) return;
  if (!configForm.name.trim()) {
    ElMessage.warning('请输入知识库名称');
    return;
  }
  configSaving.value = true;
  try {
    await updateLibrary(current.value.id, {
      name: configForm.name.trim(),
      visibility: configForm.visibility,
      description: configForm.description.trim() || null,
      chunkMode: configForm.chunkMode,
      chunkSize: configForm.chunkSize,
      chunkOverlap: configForm.chunkOverlap,
      embedModel: configForm.embedModel,
      topK: configForm.topK,
      threshold: configForm.threshold,
      weight: configForm.weight,
    });
    // 本地同步配置展示
    Object.assign(current.value, {
      name: configForm.name.trim(),
      visibility: configForm.visibility,
      description: configForm.description.trim() || null,
      chunkMode: configForm.chunkMode,
      chunkSize: configForm.chunkSize,
      chunkOverlap: configForm.chunkOverlap,
      embedModel: configForm.embedModel,
      topK: configForm.topK,
      threshold: configForm.threshold,
      weight: configForm.weight,
    });
    ElMessage.success('知识库配置已保存');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败');
  } finally {
    configSaving.value = false;
  }
}

async function removeLibrary(): Promise<void> {
  if (!current.value) return;
  try {
    await ElMessageBox.confirm(
      `确定删除知识库「${current.value.name}」？全部文档与切片将被清理`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    await deleteLibrary(current.value.id);
    ElMessage.success('知识库已删除');
    backToList();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败');
  }
}

// ===== 召回测试（M3.4）=====

const recallForm = reactive({ question: '', topN: 8 });
const recalling = ref(false);
const recallResult = ref<RecallTestResult | null>(null);

/** 相似度分级徽标 */
const GRADE_META: Record<string, { label: string; type: 'success' | 'warning' | 'danger' }> = {
  HIGH: { label: '相似度高', type: 'success' },
  MID: { label: '相似度中', type: 'warning' },
  LOW: { label: '相似度低', type: 'danger' },
};

async function runRecall(): Promise<void> {
  if (!current.value) return;
  const q = recallForm.question.trim();
  if (!q) {
    ElMessage.warning('请输入测试问题');
    return;
  }
  recalling.value = true;
  recallResult.value = null;
  try {
    recallResult.value = await recallTest(current.value.id, q, recallForm.topN);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '召回测试失败');
  } finally {
    recalling.value = false;
  }
}

/** 点击命中片段查看原文（切片全文） */
const hitDrawerVisible = ref(false);
const hitActive = ref<RecallTestResult['hits'][number] | null>(null);

function openHit(hit: RecallTestResult['hits'][number]): void {
  hitActive.value = hit;
  hitDrawerVisible.value = true;
}

// ===== 工具函数 =====

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

onBeforeUnmount(stopPolling);

function goSearch(): void {
  router.push('/search');
}
</script>

<template>
  <div class="kb-page">
    <!-- 顶栏 -->
    <header class="topbar">
      <div class="brand" @click="backToList">
        <svg class="brand-logo" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="7" fill="#2563EB" />
          <path
            d="M14 6.5a7.5 7.5 0 1 0 4.7 13.35l4.22 4.22a1.2 1.2 0 0 0 1.7-1.7l-4.22-4.22A7.5 7.5 0 0 0 14 6.5Zm-3.2 4.3h2v3.2h3.2v2h-3.2v3.2h-2v-3.2H7.6v-2h3.2v-3.2Z"
            fill="#fff"
          />
        </svg>
        <span class="brand-name">AI数智研究平台</span>
      </div>
      <div class="topbar-actions">
        <el-button plain size="small" @click="goSearch">智搜</el-button>
      </div>
    </header>

    <!-- ========== 列表态 ========== -->
    <main v-if="!current" class="list-main" v-loading="libsLoading">
      <div class="list-head">
        <div>
          <h1>知识库</h1>
          <p>集中管理研究文档与智搜成果，构建可检索的知识资产</p>
        </div>
        <el-button type="primary" @click="createVisible = true">＋ 新建知识库</el-button>
      </div>

      <div class="lib-tip">
        说明：知识库按主题归档研究资料与智搜成果；上传文档即时学习，智搜存入的成果需审核通过后自动学习入库并参与 AI 智搜的本地优先检索。
      </div>

      <el-empty
        v-if="!libsLoading && !libs.length"
        description="还没有知识库，点击右上角「新建知识库」开始构建"
      />

      <div class="lib-grid">
        <div
          v-for="lib in libs"
          :key="lib.id"
          class="lib-card"
          @click="openLibrary(lib)"
        >
          <div class="lib-card-top">
            <span class="lib-avatar" :style="{ background: lib.color }">{{ lib.name.charAt(0) }}</span>
            <el-tag :type="lib.visibility === 'PUBLIC' ? 'success' : 'info'" size="small">
              {{ lib.visibility === 'PUBLIC' ? '公共' : '私有' }}
            </el-tag>
          </div>
          <div class="lib-name">{{ lib.name }}</div>
          <div class="lib-desc">{{ lib.description || '暂无简介' }}</div>
          <div class="lib-stats-row">
            <span>{{ lib.docCount }} 文档</span>
            <span>{{ lib.readyCount }} 已学习</span>
            <span>{{ fmtTime(lib.createdAt).slice(0, 10) }}</span>
          </div>
        </div>
      </div>
    </main>

    <!-- ========== 详情三栏 ========== -->
    <main v-else class="detail-layout">
      <!-- 左：库导航 -->
      <aside class="detail-nav">
        <el-button text @click="backToList">← 返回知识库</el-button>
        <div class="lib-info">
          <span class="lib-avatar lg" :style="{ background: current.color }">{{ current.name.charAt(0) }}</span>
          <div class="lib-info-txt">
            <div class="nm">{{ current.name }}</div>
            <el-tag :type="current.visibility === 'PUBLIC' ? 'success' : 'info'" size="small">
              {{ current.visibility === 'PUBLIC' ? '公共' : '私有' }}
            </el-tag>
          </div>
        </div>
        <div class="detail-menu">
          <button class="menu-item" :class="{ active: menu === 'doc' }" @click="menu = 'doc'">
            知识文档
          </button>
          <button
            class="menu-item"
            :class="{ active: menu === 'config' }"
            @click="openConfig"
          >
            知识库配置
          </button>
          <button class="menu-item" :class="{ active: menu === 'recall' }" @click="menu = 'recall'">
            召回测试
          </button>
        </div>
        <el-button type="danger" plain size="small" class="del-lib-btn" @click="removeLibrary">
          删除知识库
        </el-button>
      </aside>

      <!-- 中右：内容区 -->
      <section class="detail-body">
        <!-- 知识文档 -->
        <template v-if="menu === 'doc'">
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
                全部 <span class="cnt">{{ current?.docCount ?? 0 }}</span>
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
                    v-for="(meta, key) in STATUS_META"
                    :key="key"
                    :label="meta.label"
                    :value="key"
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
                文档状态：待审核（智搜存入）/ 学习中 / 学习完成 / 学习失败 / 学习中断；
                失败与中断可重新学习，学习完成后参与 AI 智搜检索。
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
          </div>
        </template>

        <!-- 知识库配置 -->
        <template v-else-if="menu === 'config'">
          <div class="config-wrap">
            <h3>知识库配置</h3>
            <p class="pane-sub">配置基础信息、向量化参数与检索策略，保存后立即生效。</p>

            <div class="cfg-card">
              <div class="cfg-title">基础信息</div>
              <div class="cfg-grid">
                <div class="field">
                  <label>知识库名称</label>
                  <el-input v-model="configForm.name" />
                </div>
                <div class="field">
                  <label>可见性</label>
                  <el-radio-group v-model="configForm.visibility">
                    <el-radio value="PRIVATE">私有</el-radio>
                    <el-radio value="PUBLIC">公共</el-radio>
                  </el-radio-group>
                </div>
              </div>
              <div class="field">
                <label>简介</label>
                <el-input v-model="configForm.description" type="textarea" :rows="2" />
              </div>
            </div>

            <div class="cfg-card">
              <div class="cfg-title">向量化设置</div>
              <div class="cfg-grid four">
                <div class="field">
                  <label>分段方式</label>
                  <el-select v-model="configForm.chunkMode">
                    <el-option label="固定长度" value="FIXED" />
                    <el-option label="智能分段" value="SMART" />
                  </el-select>
                </div>
                <div class="field">
                  <label>分段长度（字符）</label>
                  <el-input-number v-model="configForm.chunkSize" :min="100" :max="4000" />
                </div>
                <div class="field">
                  <label>重叠长度（字符）</label>
                  <el-input-number v-model="configForm.chunkOverlap" :min="0" :max="500" />
                </div>
                <div class="field">
                  <label>向量模型</label>
                  <el-input v-model="configForm.embedModel" />
                </div>
              </div>
              <p class="cfg-hint">修改向量化/分段配置后，已有文档需「重新学习」才会按新参数重切。</p>
            </div>

            <div class="cfg-card">
              <div class="cfg-title">检索参数</div>
              <div class="cfg-grid three">
                <div class="field">
                  <label>召回条数 TopK</label>
                  <el-input-number v-model="configForm.topK" :min="1" :max="50" />
                </div>
                <div class="field">
                  <label>相似度阈值</label>
                  <el-input-number v-model="configForm.threshold" :min="0" :max="1" :step="0.05" />
                </div>
                <div class="field">
                  <label>本地路权重</label>
                  <el-input-number v-model="configForm.weight" :min="0.1" :max="3" :step="0.1" />
                </div>
              </div>
            </div>

            <el-button type="primary" :loading="configSaving" @click="saveConfig">保存配置</el-button>
          </div>
        </template>

        <!-- 召回测试 -->
        <template v-else>
          <div class="recall-wrap">
            <div class="recall-form">
              <h3>召回测试</h3>
              <p class="pane-sub">输入测试问题，验证该知识库的召回质量（向量 + 关键词混合检索）。</p>
              <div class="field">
                <label>测试问题</label>
                <el-input
                  v-model="recallForm.question"
                  type="textarea"
                  :rows="3"
                  placeholder="如：祁连山冰川面积变化如何？"
                />
              </div>
              <div class="field">
                <label>返回条数</label>
                <el-select v-model="recallForm.topN" style="width: 120px">
                  <el-option :value="5" label="5 条" />
                  <el-option :value="8" label="8 条" />
                  <el-option :value="10" label="10 条" />
                </el-select>
              </div>
              <el-button type="primary" :loading="recalling" @click="runRecall">开始测试</el-button>
            </div>

            <div class="recall-res">
              <template v-if="recallResult">
                <div class="recall-summary">
                  共命中 <b>{{ recallResult.total }}</b> 条候选，
                  返回前 {{ recallResult.hits.length }} 条 · 耗时 {{ recallResult.tookMs }}ms
                </div>
                <el-empty v-if="!recallResult.hits.length" description="没有召回到相关片段" />
                <div
                  v-for="hit in recallResult.hits"
                  :key="`${hit.documentId}-${hit.chunkIndex}`"
                  class="recall-item"
                  @click="openHit(hit)"
                >
                  <div class="ri-head">
                    <b>{{ hit.title }}</b>
                    <el-tag :type="GRADE_META[hit.grade].type" size="small">
                      {{ GRADE_META[hit.grade].label }} {{ hit.similarity.toFixed(2) }}
                    </el-tag>
                  </div>
                  <div class="ri-content">{{ hit.snippet }}</div>
                  <div class="ri-meta">片段 #{{ (hit.chunkIndex ?? 0) + 1 }} · 点击查看切片原文</div>
                </div>
              </template>
              <div v-else class="recall-empty">
                {{ recalling ? '正在混合检索…' : '输入测试问题并点击「开始测试」，这里将展示召回片段与相似度。' }}
              </div>
            </div>
          </div>
        </template>
      </section>
    </main>

    <!-- 新建知识库弹窗 -->
    <el-dialog v-model="createVisible" title="新建知识库" width="480px">
      <div class="field">
        <label>名称</label>
        <el-input v-model="createForm.name" placeholder="如：宏观经济研究" maxlength="40" />
      </div>
      <div class="field">
        <label>可见性</label>
        <el-radio-group v-model="createForm.visibility">
          <el-radio value="PRIVATE">私有</el-radio>
          <el-radio value="PUBLIC">公共</el-radio>
        </el-radio-group>
      </div>
      <div class="field">
        <label>简介</label>
        <el-input v-model="createForm.description" type="textarea" :rows="2" maxlength="200" />
      </div>
      <div class="field">
        <label>封面色</label>
        <div class="color-row">
          <span
            v-for="c in COLORS"
            :key="c"
            class="color-dot"
            :class="{ active: createForm.color === c }"
            :style="{ background: c }"
            @click="createForm.color = c"
          />
        </div>
      </div>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreate">创建</el-button>
      </template>
    </el-dialog>

    <!-- 文档详情抽屉 -->
    <el-drawer v-model="drawerVisible" :title="drawerDoc?.name ?? '文档详情'" size="480px">
      <div v-loading="drawerLoading">
        <template v-if="drawerDoc">
          <div class="dd-meta">
            <el-tag :type="STATUS_META[drawerDoc.status].type" size="small">
              {{ STATUS_META[drawerDoc.status].label }}
            </el-tag>
            <span class="muted">{{ fmtSize(drawerDoc.size) }} · {{ drawerDoc.chunkCount }} 切片</span>
          </div>
          <div v-if="drawerDoc.failReason" class="dd-fail">{{ drawerDoc.failReason }}</div>
          <div class="dd-chunks-title">切片预览（{{ drawerDoc.chunks.length }}）</div>
          <div v-for="c in drawerDoc.chunks" :key="c.id" class="dd-chunk">
            <div class="dd-chunk-idx">#{{ c.index + 1 }}{{ c.vectorId ? ' · 已向量化' : ' · 未向量化' }}</div>
            <div class="dd-chunk-content">{{ c.content }}</div>
          </div>
        </template>
      </div>
    </el-drawer>

    <!-- 召回片段原文抽屉 -->
    <el-drawer v-model="hitDrawerVisible" title="召回片段原文" size="460px">
      <template v-if="hitActive">
        <div class="hit-doc-name">{{ hitActive.title }}</div>
        <el-tag :type="GRADE_META[hitActive.grade].type" size="small">
          {{ GRADE_META[hitActive.grade].label }} · 相似度 {{ hitActive.similarity.toFixed(2) }}
        </el-tag>
        <pre class="hit-content">{{ hitActive.contentMd || hitActive.snippet }}</pre>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.kb-page {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #ffffff;
  border-bottom: 1px solid #eef2f7;
  padding: 10px 24px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.brand-logo {
  width: 30px;
  height: 30px;
}

.brand-name {
  font-weight: 600;
  font-size: 16px;
  color: #0f172a;
}

.spacer {
  flex: 1;
}

.muted {
  color: #94a3b8;
  font-size: 12px;
}

/* ---- 列表态 ---- */

.list-main {
  flex: 1;
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: 28px 24px 48px;
}

.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.list-head h1 {
  margin: 0;
  font-size: 24px;
  color: #0f172a;
}

.list-head p {
  margin: 6px 0 0;
  font-size: 13px;
  color: #64748b;
}

.lib-tip {
  margin-top: 18px;
  padding: 10px 14px;
  border-radius: 10px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  color: #1d4ed8;
  font-size: 12.5px;
  line-height: 1.7;
}

.lib-grid {
  margin-top: 20px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.lib-card {
  background: #fff;
  border: 1px solid #eef2f7;
  border-radius: 14px;
  padding: 18px;
  cursor: pointer;
  transition: all 0.2s;
}

.lib-card:hover {
  border-color: #2563eb;
  box-shadow: 0 6px 20px rgba(37, 99, 235, 0.1);
  transform: translateY(-1px);
}

.lib-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.lib-avatar {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  color: #fff;
  font-size: 18px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}

.lib-avatar.lg {
  width: 48px;
  height: 48px;
}

.lib-name {
  margin-top: 12px;
  font-size: 16px;
  font-weight: 600;
  color: #0f172a;
}

.lib-desc {
  margin-top: 6px;
  font-size: 12.5px;
  color: #94a3b8;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 32px;
}

.lib-stats-row {
  margin-top: 12px;
  display: flex;
  gap: 14px;
  font-size: 12px;
  color: #64748b;
}

/* ---- 详情三栏 ---- */

.detail-layout {
  flex: 1;
  display: flex;
  min-height: 0;
}

.detail-nav {
  width: 230px;
  flex: 0 0 auto;
  border-right: 1px solid #eef2f7;
  background: #fbfcfe;
  padding: 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.lib-info {
  display: flex;
  gap: 10px;
  align-items: center;
}

.lib-info-txt .nm {
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
  margin-bottom: 4px;
  word-break: break-all;
}

.detail-menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.menu-item {
  border: none;
  background: transparent;
  text-align: left;
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 13.5px;
  color: #475569;
  cursor: pointer;
  transition: all 0.15s;
}

.menu-item:hover {
  background: #eef2ff;
}

.menu-item.active {
  background: #2563eb;
  color: #fff;
}

.del-lib-btn {
  margin-top: auto;
}

.detail-body {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
}

/* ---- 文档 pane ---- */

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

/* ---- 配置 pane ---- */

.config-wrap {
  max-width: 720px;
  padding: 24px 28px;
}

.config-wrap h3 {
  margin: 0;
  font-size: 17px;
  color: #0f172a;
}

.pane-sub {
  margin: 6px 0 18px;
  font-size: 12.5px;
  color: #94a3b8;
}

.cfg-card {
  background: #fff;
  border: 1px solid #eef2f7;
  border-radius: 14px;
  padding: 18px;
  margin-bottom: 16px;
}

.cfg-title {
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
  margin-bottom: 14px;
}

.cfg-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px 20px;
}

.cfg-grid.four {
  grid-template-columns: repeat(2, 1fr);
}

.cfg-grid.three {
  grid-template-columns: repeat(3, 1fr);
}

.field {
  margin-bottom: 12px;
}

.field label {
  display: block;
  font-size: 12.5px;
  color: #64748b;
  margin-bottom: 6px;
}

.cfg-hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: #cbd5e1;
}

/* ---- 召回测试 pane ---- */

.recall-wrap {
  display: flex;
  min-height: 100%;
}

.recall-form {
  width: 300px;
  flex: 0 0 auto;
  padding: 24px 20px;
  border-right: 1px solid #eef2f7;
  background: #fff;
}

.recall-form h3 {
  margin: 0 0 4px;
  font-size: 15px;
  color: #0f172a;
}

.recall-res {
  flex: 1;
  min-width: 0;
  padding: 20px 24px;
  background: #fafbfd;
}

.recall-summary {
  font-size: 12.5px;
  color: #64748b;
  margin-bottom: 14px;
}

.recall-item {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 12px;
  cursor: pointer;
  transition: all 0.18s;
}

.recall-item:hover {
  border-color: #c7d8f8;
  box-shadow: 0 8px 20px rgba(37, 99, 235, 0.08);
  transform: translateY(-1px);
}

.ri-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.ri-head b {
  font-size: 13.5px;
  color: #1e293b;
  word-break: break-all;
}

.ri-content {
  margin-top: 8px;
  font-size: 12.5px;
  color: #64748b;
  line-height: 1.7;
}

.ri-meta {
  margin-top: 8px;
  font-size: 11.5px;
  color: #cbd5e1;
}

.recall-empty {
  padding: 80px 30px;
  text-align: center;
  color: #cbd5e1;
  font-size: 13px;
}

/* ---- 弹窗 / 抽屉 ---- */

.color-row {
  display: flex;
  gap: 8px;
}

.color-dot {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  cursor: pointer;
  border: 2px solid transparent;
}

.color-dot.active {
  border-color: #0f172a;
}

.dd-meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dd-fail {
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #fef2f2;
  color: #dc2626;
  font-size: 12.5px;
}

.dd-chunks-title {
  margin: 16px 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: #334155;
}

.dd-chunk {
  margin-bottom: 10px;
  border: 1px solid #eef2f7;
  border-radius: 10px;
  padding: 10px 12px;
}

.dd-chunk-idx {
  font-size: 11.5px;
  color: #2563eb;
  margin-bottom: 6px;
}

.dd-chunk-content {
  font-size: 12.5px;
  color: #475569;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-all;
}

.hit-doc-name {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  margin-bottom: 8px;
  word-break: break-all;
}

.hit-content {
  margin-top: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.8;
  color: #334155;
  background: #f8fafc;
  border: 1px solid #eef2f7;
  border-radius: 10px;
  padding: 14px;
}
</style>
