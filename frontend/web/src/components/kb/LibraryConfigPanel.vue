<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { updateLibrary, type KbLibrary } from '@/api/kb';

/** 知识库配置面板：基础信息 / 向量化设置 / 检索参数（进入面板时按当前库回填） */

const props = defineProps<{ current: KbLibrary }>();

const emit = defineEmits<{
  /** 保存成功，携带表单值供父组件同步本地库信息展示 */
  saved: [
    payload: {
      name: string;
      visibility: string;
      description: string | null;
      chunkMode: 'FIXED' | 'SMART';
      chunkSize: number;
      chunkOverlap: number;
      embedModel: string;
      topK: number;
      threshold: number;
      weight: number;
    },
  ];
}>();

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

onMounted(() => {
  const c = props.current;
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
});

async function saveConfig(): Promise<void> {
  if (!configForm.name.trim()) {
    ElMessage.warning('请输入知识库名称');
    return;
  }
  configSaving.value = true;
  try {
    await updateLibrary(props.current.id, {
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
    emit('saved', {
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
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败');
  } finally {
    configSaving.value = false;
  }
}
</script>

<template>
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

<style scoped>
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
</style>
