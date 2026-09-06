<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { getDocument, type KbDocumentDetail, type KbDocumentItem } from '@/api/kb';
import { STATUS_META, fmtSize } from './kb-meta';

/** 文档详情抽屉：切片预览与学习状态（抽屉状态自持，由父组件调 open() 传入文档） */

const visible = ref(false);
const loading = ref(false);
const doc = ref<KbDocumentDetail | null>(null);

/** 打开抽屉并拉取文档详情 */
async function open(item: KbDocumentItem): Promise<void> {
  visible.value = true;
  loading.value = true;
  try {
    doc.value = await getDocument(item.id);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '文档详情加载失败');
  } finally {
    loading.value = false;
  }
}

defineExpose({ open });
</script>

<template>
  <el-drawer v-model="visible" :title="doc?.name ?? '文档详情'" size="480px">
    <div v-loading="loading">
      <template v-if="doc">
        <div class="dd-meta">
          <el-tag :type="STATUS_META[doc.status].type" size="small">
            {{ STATUS_META[doc.status].label }}
          </el-tag>
          <span class="muted">{{ fmtSize(doc.size) }} · {{ doc.chunkCount }} 切片</span>
        </div>
        <div v-if="doc.failReason" class="dd-fail">{{ doc.failReason }}</div>
        <div class="dd-chunks-title">切片预览（{{ doc.chunks.length }}）</div>
        <div v-for="c in doc.chunks" :key="c.id" class="dd-chunk">
          <div class="dd-chunk-idx">#{{ c.index + 1 }}{{ c.vectorId ? ' · 已向量化' : ' · 未向量化' }}</div>
          <div class="dd-chunk-content">{{ c.content }}</div>
        </div>
      </template>
    </div>
  </el-drawer>
</template>

<style scoped>
.muted {
  color: #94a3b8;
  font-size: 12px;
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
</style>
