<script setup lang="ts">
/** 生成分析结果进度弹窗：纯展示组件，进度状态由父组件的 SSE 流驱动（不可关闭） */

const visible = defineModel<boolean>({ required: true });

defineProps<{
  /** 进度提示文案 */
  text: string;
  /** 已生成字符数 */
  chars: number;
  /** 进度百分比 */
  pct: number;
}>();
</script>

<template>
  <el-dialog v-model="visible" title="生成分析结果" width="420px" :close-on-click-modal="false" :show-close="false">
    <div class="gen-progress">
      <div class="gen-ic">
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" /></svg>
      </div>
      <div class="gen-text">{{ text }}</div>
      <div class="gen-sub" v-if="chars > 0">已生成 {{ chars }} 字</div>
      <el-progress :percentage="pct" :show-text="false" :stroke-width="8" style="margin-top: 16px" />
    </div>
  </el-dialog>
</template>

<style scoped>
.gen-progress {
  text-align: center;
  padding: 8px 4px 4px;
}
.gen-ic {
  width: 52px;
  height: 52px;
  margin: 0 auto 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background: #eff4ff;
  color: #2563eb;
}
.gen-ic svg {
  width: 28px;
  height: 28px;
}
.gen-text {
  font-size: 13px;
  color: #334155;
}
.gen-sub {
  margin-top: 6px;
  font-size: 12px;
  color: #94a3b8;
}
</style>
