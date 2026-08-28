<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionStore } from '@/stores/session';
import AdminSidebar from '@/components/AdminSidebar.vue';

const store = useSessionStore();
const route = useRoute();
const router = useRouter();

const title = computed(() => (route.meta.title as string) ?? '');

const ROLE_NAMES: Record<string, string> = {
  PLATFORM_ADMIN: '平台管理员',
  DATA_ADMIN: '数据管理员',
  USER: '普通用户',
};

const roleLabel = computed(() => ROLE_NAMES[store.roles[0]] ?? store.roles[0] ?? '');

async function onLogout() {
  await store.logout();
  router.push('/login');
}
</script>

<template>
  <div class="admin-shell">
    <AdminSidebar />
    <div class="admin-main">
      <header class="admin-topbar">
        <div class="crumb">管理端 / <strong>{{ title }}</strong></div>
        <div class="topbar-right">
          <span class="role-badge">{{ roleLabel }}</span>
          <span class="user-name">{{ store.user?.nickname }}</span>
          <button class="logout-btn" @click="onLogout">退出登录</button>
        </div>
      </header>
      <main class="admin-page">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped>
.admin-shell {
  min-height: 100vh;
}

.admin-main {
  min-height: 100vh;
  margin-left: 220px;
  display: flex;
  flex-direction: column;
}

.admin-topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  background: #fff;
  border-bottom: 1px solid #eef2f7;
}

.crumb {
  font-size: 13px;
  color: #64748b;
}

.crumb strong {
  color: #1e293b;
  font-weight: 600;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.role-badge {
  padding: 2px 10px;
  border-radius: 6px;
  background: #ecf5ff;
  color: #409eff;
  font-size: 12px;
}

.user-name {
  font-size: 13px;
  color: #334155;
}

.logout-btn {
  padding: 5px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
  color: #475569;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.logout-btn:hover {
  color: #409eff;
  border-color: #409eff;
}

.admin-page {
  flex: 1;
  padding: 20px 24px 32px;
  background: #f8fafc;
}
</style>
