<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import TopNav from '@/components/TopNav.vue';
import MarkdownView from '@/components/MarkdownView.vue';
import { fetchReportDetail, type ReportDetail } from '@/api/search';
import { exportReport, EXPORT_FORMAT_LABEL, type ExportFormat } from '@/api/workspace';

const route = useRoute();
const router = useRouter();

const loading = ref(false);
const report = ref<ReportDetail | null>(null);
const activeCite = ref<number | null>(null);

async function load(): Promise<void> {
  const id = route.params.id as string;
  if (!id) {
    router.replace('/');
    return;
  }
  loading.value = true;
  try {
    report.value = await fetchReportDetail(id);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '报告加载失败');
    router.replace('/my-reports');
  } finally {
    loading.value = false;
  }
}

/** 来源卡点击 → 正文对应角标高亮 */
function onSourceClick(idx: number): void {
  activeCite.value = activeCite.value === idx ? null : idx;
}

/** 导出 Word/PPT/PDF（type=search，id 为 sessionId） */
const exporting = ref(false);

async function onDownload(format: ExportFormat): Promise<void> {
  if (!report.value || exporting.value) return;
  exporting.value = true;
  try {
    await exportReport('search', route.params.id as string, format);
    ElMessage.success(`已导出 ${EXPORT_FORMAT_LABEL[format]} 文件`);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '导出失败');
  } finally {
    exporting.value = false;
  }
}

function sourceTypeText(t: string): string {
  if (t === 'web') return '联网';
  if (t === 'vertical') return '垂直';
  if (t === 'kb') return '知识库';
  if (t === 'upload') return '本地资料';
  return t;
}

onMounted(load);

// 同组件复用（历史记录/我的报告间切换不同报告）时，按新 id 重新加载
watch(
  () => route.params.id,
  () => {
    if (route.name === 'search-report') load();
  },
);
</script>

<template>
  <div class="sr-page">
    <TopNav />

    <div class="sr-container">
      <!-- 页头 -->
      <div class="sr-head">
        <div>
          <h1>智搜报告</h1>
          <p>正文含引文角标 [N]，点击来源卡可定位对应引文</p>
        </div>
        <div class="sr-actions">
          <button class="btn" @click="router.push('/my-reports')">
            <svg class="ic" viewBox="0 0 24 24" fill="none"><path d="M19 12H5m0 0l6-6m-6 6l6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
            返回我的报告
          </button>
          <el-dropdown trigger="click" @command="(f: ExportFormat) => onDownload(f)">
            <button class="btn primary">
              <svg class="ic" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
              导出文件
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="docx">导出 Word（.docx）</el-dropdown-item>
                <el-dropdown-item command="pptx">导出 PPT（.pptx）</el-dropdown-item>
                <el-dropdown-item command="pdf">导出 PDF（.pdf）</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>

      <div class="sr-layout">
        <!-- 正文 -->
        <div class="sr-main" v-loading="loading">
          <template v-if="report">
            <div class="sr-info">
              生成时间：{{ new Date(report.createdAt).toLocaleString() }}
              · 引用来源 {{ report.sources.length }} 项
              · Token 消耗 {{ report.tokenUsage }}
            </div>
            <div class="sr-sec">
              <MarkdownView
                :content="report.contentMd"
                :active-cite="activeCite"
                :max-cite="report.sources.length"
              />
            </div>
          </template>
          <div v-else-if="!loading" class="empty-tip">未找到该报告</div>
        </div>

        <!-- 来源卡侧栏 -->
        <aside v-if="report && report.sources.length" class="sr-aside">
          <div class="sa-head">参考来源（{{ report.sources.length }}）</div>
          <div
            v-for="s in report.sources"
            :key="s.idx"
            class="sa-card"
            :class="{ active: activeCite === s.idx }"
            @click="onSourceClick(s.idx)"
          >
            <div class="sa-top">
              <span class="sa-idx">[{{ s.idx }}]</span>
              <span class="sa-type">{{ sourceTypeText(s.sourceType) }}</span>
            </div>
            <div class="sa-title">{{ s.title }}</div>
            <a v-if="s.url" class="sa-url" :href="s.url" target="_blank" rel="noopener noreferrer">{{ s.url }}</a>
            <div v-if="s.snippet" class="sa-snippet">{{ s.snippet }}</div>
          </div>
        </aside>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sr-page {
  min-height: 100vh;
  background: #f7f9fc;
}
.sr-container {
  max-width: 1280px;
  margin: 0 auto;
  padding: 28px 24px 48px;
}
.sr-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}
.sr-head h1 {
  font-size: 24px;
  font-weight: 800;
  color: #0f172a;
  margin: 0;
}
.sr-head p {
  margin: 6px 0 0;
  font-size: 13px;
  color: #64748b;
}
.sr-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border: 1px solid #dbe2ee;
  border-radius: 9px;
  background: #fff;
  color: #334155;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.btn:hover {
  color: #2563eb;
  border-color: #2563eb;
  background: #eff4ff;
}
.btn.primary {
  color: #fff;
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  border-color: transparent;
}
.btn.primary:hover {
  filter: brightness(1.06);
}
.ic {
  width: 15px;
  height: 15px;
}
.sr-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.sr-main {
  flex: 1;
  min-width: 0;
  min-height: 200px;
}
.sr-info {
  padding: 10px 14px;
  border: 1px solid #e6edf8;
  border-radius: 10px;
  background: linear-gradient(120deg, #eff6ff, #f8fafc);
  font-size: 12px;
  color: #64748b;
  margin-bottom: 12px;
}
.sr-sec {
  padding: 18px 20px;
  border: 1px solid #e6edf8;
  border-radius: 12px;
  background: #fff;
}
.sr-aside {
  width: 300px;
  flex: 0 0 300px;
  border: 1px solid #e6edf8;
  border-radius: 12px;
  background: #fff;
  padding: 12px;
  max-height: calc(100vh - 180px);
  overflow-y: auto;
  position: sticky;
  top: 76px;
}
.sa-head {
  font-size: 13px;
  font-weight: 800;
  color: #1e40af;
  padding: 4px 6px 10px;
  border-bottom: 1px solid #f1f5f9;
  margin-bottom: 8px;
}
.sa-card {
  padding: 10px;
  border: 1px solid #eef2f7;
  border-radius: 10px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.sa-card:hover {
  border-color: #93c5fd;
}
.sa-card.active {
  border-color: #2563eb;
  background: #f5f8ff;
}
.sa-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
}
.sa-idx {
  color: #2563eb;
  font-weight: 800;
  font-size: 12px;
}
.sa-type {
  padding: 1px 7px;
  background: #eff4ff;
  color: #2563eb;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
}
.sa-title {
  font-size: 12.5px;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.5;
}
.sa-url {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: #2563eb;
  word-break: break-all;
  text-decoration: none;
}
.sa-snippet {
  margin-top: 5px;
  font-size: 11.5px;
  color: #94a3b8;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.empty-tip {
  text-align: center;
  padding: 40px 0;
  color: #94a3b8;
  font-size: 13px;
}
@media (max-width: 960px) {
  .sr-layout {
    flex-direction: column;
  }
  .sr-aside {
    width: 100%;
    flex: none;
    position: static;
    max-height: none;
  }
}
</style>
