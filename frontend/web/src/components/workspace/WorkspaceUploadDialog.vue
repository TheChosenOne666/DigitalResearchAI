<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { uploadDataset } from '@/api/workspace';
import type { UploadedFileData } from './useLocalUpload';

/** 工作台数据上传补充弹窗：选择/拖拽本地 Excel·CSV → 解析后交父组件并入工作台（弹窗状态自持） */

const emit = defineEmits<{
  /** 解析成功，待并入的文件数据（并入与国家自动选中由父组件处理） */
  committed: [payloads: UploadedFileData[]];
}>();

const visible = ref(false);
const pendingFiles = ref<File[]>([]);
const uploading = ref(false);

/** 打开弹窗并清空待上传列表 */
function open(): void {
  pendingFiles.value = [];
  visible.value = true;
}

function onPickFiles(e: Event): void {
  const input = e.target as HTMLInputElement;
  if (!input.files) return;
  const arr = Array.from(input.files);
  if (!arr.length) return;
  pendingFiles.value.push(...arr);
  ElMessage.success(`已选择 ${arr.length} 个文件，点击「完成」并入数据分析`);
  input.value = '';
}

function onDropFiles(e: DragEvent): void {
  const arr = Array.from(e.dataTransfer?.files ?? []);
  if (!arr.length) return;
  const ok = arr.filter((f) => /\.(xlsx|xls|csv)$/i.test(f.name));
  if (!ok.length) {
    ElMessage.warning('仅支持 Excel（.xlsx / .xls）或 CSV 文件');
    return;
  }
  pendingFiles.value.push(...ok);
  ElMessage.success(`已选择 ${ok.length} 个文件，点击「完成」并入数据分析`);
}

function removeFile(i: number): void {
  pendingFiles.value.splice(i, 1);
}

async function commitUpload(): Promise<void> {
  if (!pendingFiles.value.length) {
    ElMessage.warning('本次未选择本地文件');
    return;
  }
  uploading.value = true;
  try {
    const payloads: UploadedFileData[] = [];
    for (const f of pendingFiles.value) {
      const res = await uploadDataset(f);
      payloads.push({ filename: f.name, rows: res.rows, years: res.years });
    }
    emit('committed', payloads);
    ElMessage.success(`已并入 ${payloads.length} 个本地文件，表格与筛选已更新`);
    pendingFiles.value = [];
    visible.value = false;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '上传解析失败');
  } finally {
    uploading.value = false;
  }
}

defineExpose({ open });
</script>

<template>
  <el-dialog v-model="visible" title="上传本地文件" width="520px" :close-on-click-modal="false">
    <div class="up-drop" @click="() => ($refs.upInput as HTMLInputElement).click()" @dragover.prevent @drop.prevent="onDropFiles">
      <div class="up-ic">
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 16V4m0 0L8 8m4-4l4 4M4 20h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </div>
      <div class="up-t">点击上传或拖拽本地文件到此处</div>
      <div class="up-s">支持 Excel（.xlsx / .xls）、CSV · 可批量上传多个文件</div>
    </div>
    <input
      ref="upInput"
      type="file"
      accept=".xlsx,.xls,.csv"
      multiple
      style="display: none"
      @change="onPickFiles"
    />
    <div class="up-list" v-if="pendingFiles.length">
      <div v-for="(f, i) in pendingFiles" :key="f.name + i" class="up-file">
        <span class="up-name">{{ f.name }}</span>
        <span class="up-size">{{ (f.size / 1024).toFixed(0) }} KB</span>
        <span class="link" @click="removeFile(i)">移除</span>
      </div>
    </div>
    <div class="up-note">上传的本地文件将即时并入当前数据分析工作台，支持与平台多源数据合并分析、即时更新表格与图表。</div>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="uploading" @click="commitUpload">完成</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.up-drop {
  border: 1.5px dashed #cbd5e1;
  border-radius: 10px;
  padding: 26px 16px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s;
}

.up-drop:hover {
  border-color: #2563eb;
  background: #f8faff;
}

.up-ic {
  color: #2563eb;
  width: 30px;
  height: 30px;
  margin: 0 auto 8px;
}

.up-t {
  font-size: 13.5px;
  color: #334155;
}

.up-s {
  margin-top: 4px;
  font-size: 12px;
  color: #94a3b8;
}

.up-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.up-file {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: #f8fafc;
  border-radius: 8px;
  font-size: 13px;
}

.up-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #334155;
}

.up-size {
  color: #94a3b8;
  font-size: 12px;
}

.link {
  color: #2563eb;
  cursor: pointer;
  font-size: 12.5px;
}

.up-note {
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.7;
  color: #94a3b8;
}
</style>
