<script setup lang="ts">
import { reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { createLibrary } from '@/api/kb';
import { KB_COLORS } from './kb-meta';

/** 新建知识库弹窗：名称/可见性/简介/封面色（弹窗状态自持，创建成功后通知父组件刷新） */

const emit = defineEmits<{ created: [] }>();

const visible = ref(false);
const creating = ref(false);
const createForm = reactive({ name: '', visibility: 'PRIVATE', color: KB_COLORS[0], description: '' });

/** 打开弹窗（表单保留上次输入，仅创建成功后清空名称/简介，与原实现一致） */
function open(): void {
  visible.value = true;
}

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
    visible.value = false;
    emit('created');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '创建失败');
  } finally {
    creating.value = false;
  }
}

defineExpose({ open });
</script>

<template>
  <el-dialog v-model="visible" title="新建知识库" width="480px">
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
          v-for="c in KB_COLORS"
          :key="c"
          class="color-dot"
          :class="{ active: createForm.color === c }"
          :style="{ background: c }"
          @click="createForm.color = c"
        />
      </div>
    </div>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="creating" @click="submitCreate">创建</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.field {
  margin-bottom: 12px;
}

.field label {
  display: block;
  font-size: 12.5px;
  color: #64748b;
  margin-bottom: 6px;
}

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
</style>
