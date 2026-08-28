<script setup lang="ts">
import { useRoute } from 'vue-router';

const route = useRoute();
const title = (route.meta.title as string) ?? '';
</script>

<template>
  <div class="placeholder">
    <div class="placeholder-card">
      <svg class="ph-icon" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="#ecf5ff" />
        <path
          d="M8 22v-6M14 22V10M20 22v-9M26 22v-4"
          stroke="#409eff"
          stroke-width="2.6"
          stroke-linecap="round"
        />
      </svg>
      <h2>{{ title }}</h2>
      <p>该模块将在后续批次交付</p>
    </div>
  </div>
</template>

<style scoped>
.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
}

.placeholder-card {
  text-align: center;
  padding: 48px 56px;
  background: #fff;
  border: 1px solid #eef2f7;
  border-radius: 14px;
  box-shadow: 0 4px 20px rgba(30, 41, 59, 0.04);
}

.ph-icon {
  width: 56px;
  height: 56px;
}

.placeholder-card h2 {
  margin: 16px 0 0;
  font-size: 18px;
  font-weight: 600;
  color: #0f172a;
}

.placeholder-card p {
  margin: 8px 0 0;
  font-size: 13px;
  color: #94a3b8;
}
</style>
