<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import TopNav from '@/components/TopNav.vue';
import DocumentPanel from '@/components/kb/DocumentPanel.vue';
import LibraryConfigPanel from '@/components/kb/LibraryConfigPanel.vue';
import RecallTestPanel from '@/components/kb/RecallTestPanel.vue';
import CreateLibraryDialog from '@/components/kb/CreateLibraryDialog.vue';
import { deleteLibrary, listLibraries, type KbLibrary } from '@/api/kb';
import { fmtTime } from '@/components/kb/kb-meta';

// ===== 页面级状态 =====

const libs = ref<KbLibrary[]>([]);
const libsLoading = ref(false);
/** 当前进入的库（null = 列表态） */
const current = ref<KbLibrary | null>(null);

/** 左侧菜单：doc 文档 / config 配置 / recall 召回测试 */
const menu = ref<'doc' | 'config' | 'recall'>('doc');

const createDialogRef = ref<InstanceType<typeof CreateLibraryDialog> | null>(null);

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
}

function backToList(): void {
  current.value = null;
  void refreshLibs();
}

/** 切到配置面板（配置表单由面板挂载时按当前库回填） */
function openConfig(): void {
  menu.value = 'config';
}

/** 配置保存成功后同步本地库信息展示 */
function onConfigSaved(payload: Record<string, unknown>): void {
  if (current.value) Object.assign(current.value, payload);
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
</script>

<template>
  <div class="kb-page">
    <TopNav />

    <!-- ========== 列表态 ========== -->
    <main v-if="!current" class="list-main" v-loading="libsLoading">
      <div class="list-head">
        <div>
          <h1>知识库</h1>
          <p>集中管理研究文档与智搜成果，构建可检索的知识资产</p>
        </div>
        <el-button type="primary" @click="createDialogRef?.open()">＋ 新建知识库</el-button>
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
        <DocumentPanel v-if="menu === 'doc'" :key="current.id" :current="current" />

        <!-- 知识库配置 -->
        <LibraryConfigPanel
          v-else-if="menu === 'config'"
          :key="current.id"
          :current="current"
          @saved="onConfigSaved"
        />

        <!-- 召回测试 -->
        <RecallTestPanel v-else :key="current.id" :current="current" />
      </section>
    </main>

    <!-- 新建知识库弹窗 -->
    <CreateLibraryDialog ref="createDialogRef" @created="refreshLibs" />
  </div>
</template>

<style scoped>
.kb-page {
  min-height: 100%;
  display: flex;
  flex-direction: column;
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
</style>
