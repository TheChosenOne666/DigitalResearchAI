<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import LoginDialog from '@/components/LoginDialog.vue';
import { useSessionStore } from '@/stores/session';

const router = useRouter();
const session = useSessionStore();
const showLogin = ref(false);

async function onLogout(): Promise<void> {
  await session.logout();
  ElMessage.success('已退出登录');
}

function goSearch(): void {
  router.push('/search');
}

function goKnowledge(): void {
  router.push('/knowledge');
}
</script>

<template>
  <div class="home-page">
    <div class="hero">
      <svg class="hero-logo" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="#2563EB" />
        <path
          d="M14 6.5a7.5 7.5 0 1 0 4.7 13.35l4.22 4.22a1.2 1.2 0 0 0 1.7-1.7l-4.22-4.22A7.5 7.5 0 0 0 14 6.5Zm-3.2 4.3h2v3.2h3.2v2h-3.2v3.2h-2v-3.2H7.6v-2h3.2v-3.2Z"
          fill="#fff"
        />
      </svg>
      <h1 class="hero-title">AI数智研究平台</h1>
      <p class="hero-sub">提问 → 多源检索 → 智能分析 → 结构化报告</p>

      <div class="hero-actions">
        <template v-if="session.isLoggedIn && session.user">
          <el-button type="primary" size="large" @click="goSearch">
            进入智搜
          </el-button>
          <el-button size="large" @click="goKnowledge">知识库</el-button>
          <div class="user-chip">
            <span class="user-name">{{ session.user.nickname }}</span>
            <span class="user-phone">{{ session.user.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2') }}</span>
            <el-button link type="primary" @click="onLogout">退出登录</el-button>
          </div>
        </template>
        <template v-else>
          <el-button type="primary" size="large" @click="showLogin = true">
            登录 / 注册
          </el-button>
        </template>
      </div>
    </div>

    <LoginDialog v-if="showLogin" @success="showLogin = false" @close="showLogin = false" />
  </div>
</template>

<style scoped>
.home-page {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hero {
  text-align: center;
}

.hero-logo {
  width: 64px;
  height: 64px;
}

.hero-title {
  margin: 20px 0 0;
  font-size: 30px;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: 1px;
}

.hero-sub {
  margin: 12px 0 0;
  font-size: 15px;
  color: #64748b;
}

.hero-actions {
  margin-top: 32px;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.user-chip {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 10px 18px;
}

.user-name {
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
}

.user-phone {
  font-size: 13px;
  color: #64748b;
}
</style>
