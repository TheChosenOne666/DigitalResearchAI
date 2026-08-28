<script setup lang="ts">
defineProps<{
  title: string;
  desc?: string;
  tags?: string[];
}>();
</script>

<template>
  <div class="page-head">
    <div>
      <h1>{{ title }}</h1>
      <div v-if="desc" class="desc">{{ desc }}</div>
    </div>
    <div v-if="tags && tags.length" class="fp-tags">
      <span v-for="t in tags" :key="t" class="tag">{{ t }}</span>
    </div>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}

.page-head h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: #0f172a;
}

.desc {
  margin-top: 6px;
  font-size: 13px;
  color: #64748b;
}

.fp-tags {
  display: flex;
  gap: 8px;
}

.tag {
  padding: 2px 10px;
  border-radius: 6px;
  background: #ecf5ff;
  color: #409eff;
  font-size: 12px;
}
</style>
