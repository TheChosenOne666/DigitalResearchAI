<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();
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
        <el-button type="primary" size="large" @click="router.push('/login')">
          登录 / 注册
        </el-button>
      </div>
      <p class="hero-note">AI 智搜首页将随 M2 里程碑上线</p>
    </div>
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
}

.hero-note {
  margin-top: 20px;
  font-size: 12px;
  color: #94a3b8;
}
</style>
