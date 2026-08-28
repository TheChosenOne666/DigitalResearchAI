<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useSessionStore } from '@/stores/session';
import { ApiError } from '@/api/http';
import { ErrorCode } from '@app/shared';

const router = useRouter();
const route = useRoute();
const store = useSessionStore();

const form = reactive({ phone: '', password: '' });
const loading = ref(false);

async function onLogin() {
  if (!/^1[3-9]\d{9}$/.test(form.phone)) {
    ElMessage.warning('请输入正确的管理员手机号');
    return;
  }
  if (!form.password) {
    ElMessage.warning('请输入密码');
    return;
  }
  loading.value = true;
  try {
    await store.login(form.phone, form.password);
    const redirect = (route.query.redirect as string) || '/dashboard';
    router.push(redirect);
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.code === ErrorCode.FORBIDDEN) {
        ElMessage.error('该账号无管理端权限');
      } else if (e.code === ErrorCode.LOGIN_FAILED) {
        ElMessage.error('账号或密码错误');
      } else if (e.code === ErrorCode.ACCOUNT_DISABLED) {
        ElMessage.error('账号已被禁用');
      } else {
        ElMessage.error(e.message || '登录失败');
      }
    } else {
      ElMessage.error('登录失败，请稍后重试');
    }
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="brand">
        <svg class="brand-logo" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="7" fill="#409eff" />
          <path d="M8 22v-6M14 22V10M20 22v-9M26 22v-4" stroke="#fff" stroke-width="2.6" stroke-linecap="round" />
        </svg>
        <div>
          <div class="brand-name">
            AI数智研究平台
            <span class="brand-badge">管理端</span>
          </div>
          <div class="brand-sub">平台运营管理后台</div>
        </div>
      </div>

      <el-input v-model="form.phone" size="large" maxlength="11" placeholder="请输入管理员手机号">
        <template #prefix>
          <svg class="input-icon" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.6" />
            <path d="M4.5 20a7.5 7.5 0 0 1 15 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          </svg>
        </template>
      </el-input>
      <el-input
        v-model="form.password"
        size="large"
        type="password"
        show-password
        placeholder="请输入密码"
        class="pwd-input"
        @keyup.enter="onLogin"
      >
        <template #prefix>
          <svg class="input-icon" viewBox="0 0 24 24" fill="none">
            <rect x="4" y="10" width="16" height="10" rx="3" stroke="currentColor" stroke-width="1.6" />
            <path d="M8 10V8a4 4 0 0 1 8 0v2" stroke="currentColor" stroke-width="1.6" />
            <circle cx="12" cy="15" r="1.4" fill="currentColor" />
          </svg>
        </template>
      </el-input>

      <el-button type="primary" size="large" class="login-btn" :loading="loading" @click="onLogin">登 录</el-button>
      <div class="agreement">仅限平台管理员 / 数据管理员访问</div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: linear-gradient(135deg, #f0f5fb 0%, #e8f0f8 100%);
}

.login-card {
  width: 400px;
  background: #fff;
  border-radius: 14px;
  border: 1px solid #eef2f7;
  box-shadow: 0 8px 30px rgba(30, 41, 59, 0.08);
  padding: 36px 36px 28px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 28px;
}

.brand-logo {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
}

.brand-name {
  font-size: 20px;
  font-weight: 600;
  color: #0f172a;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.brand-badge {
  font-size: 11px;
  font-weight: 500;
  color: #409eff;
  background: #ecf5ff;
  border-radius: 6px;
  padding: 2px 8px;
}

.brand-sub {
  margin-top: 4px;
  font-size: 12px;
  color: #64748b;
}

.input-icon {
  width: 18px;
  height: 18px;
  color: #94a3b8;
}

.pwd-input {
  margin-top: 16px;
}

.login-btn {
  width: 100%;
  margin-top: 24px;
  font-weight: 600;
  letter-spacing: 4px;
}

.agreement {
  margin-top: 14px;
  text-align: center;
  font-size: 12px;
  color: #94a3b8;
}
</style>
