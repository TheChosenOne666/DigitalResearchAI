<script setup lang="ts"></script>

<template>
  <div class="dashboard-page">
    <div class="placeholder">
      <svg class="placeholder-logo" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="#1E4FBC" />
        <path
          d="M8 22v-6M14 22V10M20 22v-9M26 22v-4"
          stroke="#fff"
          stroke-width="2.6"
          stroke-linecap="round"
        />
      </svg>
      <h1 class="placeholder-title">运营看板</h1>
      <p class="placeholder-sub">管理端 9 模块 20 功能将按 M6 里程碑逐模块落地</p>
      <el-button type="primary" plain @click="$router.push('/login')">前往登录</el-button>
    </div>
  </div>
</template>

<style scoped>
.dashboard-page {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.placeholder {
  text-align: center;
}

.placeholder-logo {
  width: 56px;
  height: 56px;
}

.placeholder-title {
  margin: 16px 0 0;
  font-size: 22px;
  font-weight: 600;
  color: #0f172a;
}

.placeholder-sub {
  margin: 10px 0 24px;
  font-size: 13px;
  color: #64748b;
}
</style>
