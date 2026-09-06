<script setup lang="ts">
import { reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { recallTest, type RecallTestResult, type KbLibrary } from '@/api/kb';
import { GRADE_META } from './kb-meta';

/** 召回测试面板（M3.4）：混合检索质量验证 + 命中片段原文抽屉 */

const props = defineProps<{ current: KbLibrary }>();

const recallForm = reactive({ question: '', topN: 8 });
const recalling = ref(false);
const recallResult = ref<RecallTestResult | null>(null);

async function runRecall(): Promise<void> {
  const q = recallForm.question.trim();
  if (!q) {
    ElMessage.warning('请输入测试问题');
    return;
  }
  recalling.value = true;
  recallResult.value = null;
  try {
    recallResult.value = await recallTest(props.current.id, q, recallForm.topN);
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
</script>

<template>
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

.pane-sub {
  margin: 6px 0 18px;
  font-size: 12.5px;
  color: #94a3b8;
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
