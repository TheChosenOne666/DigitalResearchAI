<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import TopNav from '@/components/TopNav.vue';
import MarkdownView from '@/components/MarkdownView.vue';
import {
  fetchAnalyzeReport,
  saveAnalyzeToKb,
  type AnalyzeReportDetail,
} from '@/api/workspace';
import { listLibraries, listGroups, type KbLibrary, type KbGroup } from '@/api/kb';

const route = useRoute();
const router = useRouter();

const loading = ref(false);
const report = ref<AnalyzeReportDetail | null>(null);

const stats = computed(() => report.value?.paramsSnapshot?.stats ?? null);
const indicator = computed(() => report.value?.paramsSnapshot?.indicator ?? null);
const countries = computed(() => report.value?.paramsSnapshot?.countries ?? []);

/** 指标单位（期末均值/数据表展示用） */
const unit = computed(() => indicator.value?.unit ?? '');

/** 数值格式化（整型单位取整，其余保留 1 位小数） */
function fmt(v: number | null | undefined): string {
  if (v == null) return '..';
  if (unit.value === '美元' || unit.value === '人' || unit.value === '百万人') {
    return String(Math.round(v));
  }
  return v.toFixed(1);
}

/** 区间变动带符号 */
function fmtChange(v: number | null | undefined): string {
  if (v == null) return '..';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

async function load(): Promise<void> {
  const id = route.params.id as string;
  if (!id) {
    router.replace('/workspace');
    return;
  }
  loading.value = true;
  try {
    report.value = await fetchAnalyzeReport(id);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '报告加载失败');
    router.replace('/workspace');
  } finally {
    loading.value = false;
  }
}

function backToWorkspace(): void {
  router.push('/workspace');
}

/** 下载文件（M4.3：导出 Markdown；Word/PPT 正式导出留 M4.4） */
function downloadMarkdown(): void {
  if (!report.value) return;
  const blob = new Blob(['\ufeff' + report.value.contentMd], {
    type: 'text/markdown;charset=utf-8',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${report.value.title || '分析报告'}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  ElMessage.success('已导出 Markdown 文件');
}

// ===== 存入知识库 =====

const saveVisible = ref(false);
const saving = ref(false);
const libraries = ref<KbLibrary[]>([]);
const groups = ref<KbGroup[]>([]);
const saveForm = ref({
  libraryId: '',
  groupId: '' as string | null,
  visibility: 'PRIVATE',
  tags: '',
});

async function openSave(): Promise<void> {
  if (!report.value) return;
  saveForm.value = { libraryId: '', groupId: null, visibility: 'PRIVATE', tags: '' };
  groups.value = [];
  saveVisible.value = true;
  try {
    libraries.value = await listLibraries();
    if (libraries.value.length) {
      saveForm.value.libraryId = libraries.value[0].id;
      await loadGroups();
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '知识库列表加载失败');
  }
}

async function onLibChange(): Promise<void> {
  saveForm.value.groupId = null;
  await loadGroups();
}

async function loadGroups(): Promise<void> {
  groups.value = [];
  if (!saveForm.value.libraryId) return;
  try {
    groups.value = await listGroups(saveForm.value.libraryId);
  } catch {
    /* 分组加载失败不阻断 */
  }
}

async function submitSave(): Promise<void> {
  if (!report.value) return;
  if (!saveForm.value.libraryId) {
    ElMessage.warning('请选择目标知识库');
    return;
  }
  saving.value = true;
  try {
    const tags = saveForm.value.tags
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    await saveAnalyzeToKb(report.value.id, {
      libraryId: saveForm.value.libraryId,
      groupId: saveForm.value.groupId || null,
      visibility: saveForm.value.visibility,
      tags,
    });
    saveVisible.value = false;
    ElMessage.success('已提交审核，审核通过后自动学习入库');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '存入知识库失败');
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="anz-page">
    <TopNav />

    <div class="anz-container">
      <!-- 页头 -->
      <div class="anz-head">
        <div>
          <h1>分析结果</h1>
          <p>基于检索与筛选数据的再次分析报告：完整报告 · 数据来源 · 数据分析表</p>
        </div>
        <div class="anz-actions">
          <button class="btn" @click="backToWorkspace">
            <svg class="ic" viewBox="0 0 24 24" fill="none"><path d="M19 12H5m0 0l6-6m-6 6l6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
            返回数据分析工作台
          </button>
          <button class="btn" @click="downloadMarkdown">
            <svg class="ic" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
            下载文件
          </button>
          <button class="btn primary" @click="openSave">
            <svg class="ic" viewBox="0 0 24 24" fill="none"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
            存入知识库
          </button>
        </div>
      </div>

      <div v-loading="loading" class="anz-body">
        <template v-if="report">
          <!-- 报告信息条 -->
          <div class="anz-info">
            <div class="t">{{ report.title }}</div>
            <div class="m">
              生成时间：{{ new Date(report.createdAt).toLocaleString() }}
              <template v-if="indicator"> · 指标：{{ indicator.name }}</template>
              <br />
              覆盖 {{ countries.length }} 个国家/地区 · 基于工作台筛选数据生成
            </div>
          </div>

          <!-- 统计卡片 -->
          <div v-if="stats" class="anz-stats">
            <div class="stat">
              <div class="k">样本覆盖</div>
              <div class="v">{{ stats.sampleCount }} 国</div>
              <div class="s">按末年值降序</div>
            </div>
            <div class="stat">
              <div class="k">时间跨度</div>
              <div class="v">{{ stats.yearRange }}</div>
              <div class="s">{{ stats.yearCount }} 个年份</div>
            </div>
            <div class="stat">
              <div class="k">期末均值</div>
              <div class="v">{{ fmt(stats.endAvg) }}{{ unit }}</div>
              <div class="s">末年非空样本平均</div>
            </div>
            <div class="stat">
              <div class="k">区间变动</div>
              <div class="v">{{ fmtChange(stats.changePct) }}</div>
              <div class="s">期初至期末累计</div>
            </div>
            <div class="stat">
              <div class="k">数据完整率</div>
              <div class="v">{{ stats.completeness.toFixed(1) }}%</div>
              <div class="s">{{ stats.nonNull }} / {{ stats.totalCells }} 单元格</div>
            </div>
          </div>

          <!-- 报告正文（含 14 章节：摘要、背景、结论、解读、逐国、年度、分组、趋势、口径、数据表、来源、可视化、风险、方法） -->
          <div class="anz-sec">
            <MarkdownView :content="report.contentMd" />
          </div>

          <div class="anz-note">
            数据来源：世界发展指标数据库（WDI） · 缺失值以「..」占位、不参与计算 · 本结果由 AI 自动生成，仅供研究参考。
          </div>
        </template>

        <div v-else-if="!loading" class="empty-tip">未找到该分析报告</div>
      </div>
    </div>

    <!-- 存入知识库弹窗 -->
    <el-dialog v-model="saveVisible" title="存入知识库" width="480px" :close-on-click-modal="false">
      <div class="save-form">
        <div class="field">
          <label>文档名称</label>
          <div class="doc-name">{{ report?.title || '分析报告' }}</div>
        </div>
        <div class="field">
          <label>目标知识库</label>
          <el-select v-model="saveForm.libraryId" placeholder="选择知识库" style="width: 100%" @change="onLibChange">
            <el-option v-for="lib in libraries" :key="lib.id" :label="lib.name" :value="lib.id" />
          </el-select>
        </div>
        <div class="field">
          <label>分组（可空）</label>
          <el-select v-model="saveForm.groupId" placeholder="不分组" clearable style="width: 100%">
            <el-option v-for="g in groups" :key="g.id" :label="g.name" :value="g.id" />
          </el-select>
        </div>
        <div class="field">
          <label>可见范围</label>
          <el-radio-group v-model="saveForm.visibility">
            <el-radio value="PRIVATE">私有</el-radio>
            <el-radio value="PUBLIC">公开</el-radio>
          </el-radio-group>
        </div>
        <div class="field">
          <label>标签（逗号分隔）</label>
          <el-input v-model="saveForm.tags" placeholder="如：GDP增长率, 时序, 分析" />
        </div>
        <div class="hint">提交后需管理员审核，审核通过后自动学习入库并参与 AI 智搜知识库优先检索。</div>
      </div>
      <template #footer>
        <el-button @click="saveVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitSave">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.anz-page {
  min-height: 100vh;
  background: #f7f9fc;
}
.anz-container {
  max-width: 1080px;
  margin: 0 auto;
  padding: 28px 24px 48px;
}
.anz-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}
.anz-head h1 {
  font-size: 24px;
  font-weight: 800;
  color: #0f172a;
  margin: 0;
}
.anz-head p {
  margin: 6px 0 0;
  font-size: 13px;
  color: #64748b;
}
.anz-actions {
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
.anz-body {
  min-height: 200px;
}
.anz-info {
  padding: 14px 16px;
  border: 1px solid #e6edf8;
  border-radius: 12px;
  background: linear-gradient(120deg, #eff6ff, #f8fafc);
  margin-bottom: 16px;
}
.anz-info .t {
  font-size: 15px;
  font-weight: 800;
  color: #0f172a;
}
.anz-info .m {
  margin-top: 6px;
  font-size: 12px;
  color: #64748b;
  line-height: 1.7;
}
.anz-stats {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}
.stat {
  padding: 12px 14px;
  border: 1px solid #e6edf8;
  border-radius: 12px;
  background: #fff;
}
.stat .k {
  font-size: 11px;
  color: #94a3b8;
  font-weight: 700;
}
.stat .v {
  margin-top: 5px;
  font-size: 17px;
  font-weight: 800;
  color: #0f172a;
}
.stat .s {
  margin-top: 3px;
  font-size: 11px;
  color: #94a3b8;
}
.anz-sec {
  padding: 18px 20px;
  border: 1px solid #e6edf8;
  border-radius: 12px;
  background: #fff;
  margin-bottom: 16px;
}
.anz-sec .hd {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
  font-weight: 800;
  color: #1e40af;
  margin-bottom: 10px;
}
.tbl-wrap {
  overflow: auto;
  max-height: 360px;
  border: 1px solid #eef2f7;
  border-radius: 8px;
}
.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.tbl th,
.tbl td {
  padding: 7px 10px;
  border-bottom: 1px solid #eef2f7;
  white-space: nowrap;
  text-align: right;
}
.tbl thead th {
  background: #f1f5f9;
  color: #475569;
  font-weight: 700;
  text-align: center;
  position: sticky;
  top: 0;
}
.tbl td:first-child,
.tbl thead th:first-child {
  text-align: left;
  font-weight: 600;
  color: #0f172a;
}
.tbl tbody th {
  text-align: left;
  font-weight: 600;
  color: #0f172a;
}
.src-list {
  display: flex;
  flex-direction: column;
}
.src {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px dashed #eef2f7;
  font-size: 12.5px;
  flex-wrap: wrap;
}
.src .idx {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #eff4ff;
  color: #2563eb;
  font-size: 11px;
  font-weight: 700;
  flex: 0 0 auto;
}
.src .name {
  font-weight: 600;
  color: #0f172a;
}
.src .url {
  color: #2563eb;
  word-break: break-all;
}
.src .desc {
  color: #94a3b8;
}
.anz-note {
  font-size: 11.5px;
  color: #94a3b8;
  line-height: 1.7;
  padding: 12px 14px;
  background: #f8fafc;
  border-radius: 8px;
}
.empty-tip {
  text-align: center;
  padding: 40px 0;
  color: #94a3b8;
  font-size: 13px;
}
.save-form .field {
  margin-bottom: 14px;
}
.save-form label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: #475569;
  font-weight: 600;
}
.save-form .doc-name {
  padding: 9px 12px;
  background: #f8fafc;
  border: 1px solid #eef2f7;
  border-radius: 8px;
  font-size: 13px;
  color: #334155;
}
.save-form .hint {
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.7;
}
@media (max-width: 900px) {
  .anz-stats {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
