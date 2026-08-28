<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useSessionStore } from '@/stores/session';

const store = useSessionStore();
const route = useRoute();
const menus = computed(() => store.menus);
</script>

<template>
  <aside class="admin-sidebar">
    <div class="brand">
      <div class="brand-mark">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="7" fill="#409eff" />
          <path d="M8 22v-6M14 22V10M20 22v-9M26 22v-4" stroke="#fff" stroke-width="2.6" stroke-linecap="round" />
        </svg>
      </div>
      <div class="brand-text">
        <strong>AI数智研究平台</strong>
        <small>管理端</small>
      </div>
    </div>

    <nav class="nav">
      <div v-for="group in menus" :key="group.key" class="nav-group">
        <div class="nav-group-label">{{ group.label }}</div>
        <router-link
          v-for="item in group.items"
          :key="item.key"
          :to="item.path"
          class="nav-item"
          :class="{ active: route.path === item.path }"
        >
          <span>{{ item.label }}</span>
        </router-link>
      </div>
    </nav>
  </aside>
</template>

<style scoped>
.admin-sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 30;
  width: 220px;
  display: flex;
  flex-direction: column;
  background: #2f4050;
  overflow-y: auto;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 16px;
  border-bottom: 1px solid #3a5266;
}

.brand-mark svg {
  width: 34px;
  height: 34px;
  display: block;
}

.brand-text {
  display: flex;
  flex-direction: column;
}

.brand-text strong {
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.brand-text small {
  margin-top: 2px;
  color: #8fa3b1;
  font-size: 11px;
}

.nav {
  flex: 1;
  padding: 8px 0 24px;
}

.nav-group {
  margin-top: 14px;
}

.nav-group-label {
  padding: 0 16px 6px;
  color: #7f96a6;
  font-size: 12px;
  font-weight: 700;
}

.nav-item {
  display: flex;
  align-items: center;
  height: 38px;
  padding: 0 16px 0 26px;
  color: #c8d3db;
  font-size: 13px;
  text-decoration: none;
  border-left: 3px solid transparent;
  transition: background 0.15s ease, color 0.15s ease;
}

.nav-item:hover {
  color: #fff;
  background: #3a5266;
}

.nav-item.active {
  color: #fff;
  background: #409eff;
  border-left-color: #fff;
}
</style>
