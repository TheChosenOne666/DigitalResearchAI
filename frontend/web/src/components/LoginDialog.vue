<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { request, ApiError } from '@/api/http';
import { useSessionStore } from '@/stores/session';
import type { LoginResult } from '@app/shared';

/** 登录成功回调（父组件关闭弹窗/跳转） */
const emit = defineEmits<{ success: []; close: [] }>();

const session = useSessionStore();
const activeTab = ref('sms');
const loading = ref(false);
const smsForm = reactive({ phone: '', code: '' });
const pwdForm = reactive({ phone: '', password: '' });

/** 验证码倒计时（60s） */
const countdown = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;

const phoneValid = computed(() => /^1[3-9]\d{9}$/.test(smsForm.phone));

function startCountdown(): void {
  countdown.value = 60;
  timer = setInterval(() => {
    countdown.value--;
    if (countdown.value <= 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  }, 1000);
}

/** 发送验证码（60s 倒计时 + 后端防刷校验） */
async function onSendCode(): Promise<void> {
  if (!phoneValid.value) {
    ElMessage.warning('请输入正确的手机号');
    return;
  }
  try {
    await request('/api/v1/auth/sms/send', {
      method: 'POST',
      body: JSON.stringify({ phone: smsForm.phone }),
    });
    startCountdown();
    ElMessage.success('验证码已发送');
  } catch (err) {
    if (err instanceof ApiError) {
      ElMessage.error(err.message);
    } else {
      ElMessage.error('发送失败，请稍后重试');
    }
  }
}

async function onLogin(): Promise<void> {
  if (loading.value) return;
  try {
    let result: LoginResult;
    if (activeTab.value === 'sms') {
      if (!phoneValid.value || !/^\d{6}$/.test(smsForm.code)) {
        ElMessage.warning('请填写正确的手机号和验证码');
        return;
      }
      result = await doLogin('/api/v1/auth/sms/login', {
        phone: smsForm.phone,
        code: smsForm.code,
      });
    } else {
      if (!/^1[3-9]\d{9}$/.test(pwdForm.phone) || pwdForm.password.length < 6) {
        ElMessage.warning('请填写正确的账号和密码（密码至少 6 位）');
        return;
      }
      result = await doLogin('/api/v1/auth/login', {
        phone: pwdForm.phone,
        password: pwdForm.password,
      });
    }
    session.setSession(result);
    ElMessage.success(`欢迎回来，${result.user.nickname}`);
    emit('success');
  } catch (err) {
    if (err instanceof ApiError) {
      ElMessage.error(err.message);
    } else {
      ElMessage.error('登录失败，请稍后重试');
    }
  }
}

async function doLogin(url: string, body: Record<string, string>): Promise<LoginResult> {
  loading.value = true;
  try {
    return await request<LoginResult>(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-dialog" @click.self="emit('close')">
    <div class="login-card">
      <button class="close-btn" aria-label="关闭" @click="emit('close')">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
      </button>

      <div class="brand">
        <svg class="brand-logo" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="7" fill="#2563EB" />
          <path
            d="M14 6.5a7.5 7.5 0 1 0 4.7 13.35l4.22 4.22a1.2 1.2 0 0 0 1.7-1.7l-4.22-4.22A7.5 7.5 0 0 0 14 6.5Zm-3.2 4.3h2v3.2h3.2v2h-3.2v3.2h-2v-3.2H7.6v-2h3.2v-3.2Z"
            fill="#fff"
          />
        </svg>
        <div>
          <div class="brand-name">登录 AI数智研究平台</div>
          <div class="brand-sub">未注册手机号将自动创建账号</div>
        </div>
      </div>

      <el-tabs v-model="activeTab" class="login-tabs">
        <el-tab-pane label="验证码登录" name="sms">
          <el-input
            v-model="smsForm.phone"
            size="large"
            placeholder="请输入手机号"
            maxlength="11"
          >
            <template #prefix>
              <span class="phone-prefix">+86</span>
            </template>
          </el-input>
          <div class="code-row">
            <el-input
              v-model="smsForm.code"
              size="large"
              placeholder="请输入验证码"
              maxlength="6"
            >
              <template #prefix>
                <svg class="input-icon" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" stroke-width="1.6" />
                  <path d="M7 9h10M7 13h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                </svg>
              </template>
            </el-input>
            <el-button
              size="large"
              class="send-btn"
              :disabled="countdown > 0"
              @click="onSendCode"
            >
              {{ countdown > 0 ? `${countdown}s 后重发` : '获取验证码' }}
            </el-button>
          </div>
        </el-tab-pane>

        <el-tab-pane label="账号密码登录" name="pwd">
          <el-input v-model="pwdForm.phone" size="large" placeholder="请输入手机号" maxlength="11">
            <template #prefix>
              <svg class="input-icon" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.6" />
                <path d="M4.5 20a7.5 7.5 0 0 1 15 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
              </svg>
            </template>
          </el-input>
          <el-input
            v-model="pwdForm.password"
            size="large"
            type="password"
            show-password
            placeholder="请输入密码"
            style="margin-top: 16px"
          >
            <template #prefix>
              <svg class="input-icon" viewBox="0 0 24 24" fill="none">
                <rect x="4" y="10" width="16" height="10" rx="3" stroke="currentColor" stroke-width="1.6" />
                <path d="M8 10V8a4 4 0 0 1 8 0v2" stroke="currentColor" stroke-width="1.6" />
                <circle cx="12" cy="15" r="1.4" fill="currentColor" />
              </svg>
            </template>
          </el-input>
        </el-tab-pane>
      </el-tabs>

      <el-button type="primary" size="large" class="login-btn" :loading="loading" @click="onLogin">
        登 录
      </el-button>
      <div class="agreement">登录即同意《服务协议》与《隐私政策》</div>
    </div>
  </div>
</template>

<style scoped>
.login-dialog {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 24px;
}

.login-card {
  position: relative;
  width: 420px;
  background: #fff;
  border-radius: 14px;
  border: 1px solid #eef2f7;
  box-shadow: 0 8px 30px rgba(30, 41, 59, 0.06);
  padding: 32px 36px 24px;
}

.close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover {
  background: #f1f5f9;
  color: #475569;
}

.close-btn svg {
  width: 16px;
  height: 16px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}

.brand-logo {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
}

.brand-name {
  font-size: 18px;
  font-weight: 600;
  color: #0f172a;
}

.brand-sub {
  margin-top: 3px;
  font-size: 12px;
  color: #64748b;
}

.phone-prefix {
  color: #475569;
  font-size: 14px;
  padding-right: 8px;
  border-right: 1px solid #e2e8f0;
  margin-right: 8px;
}

.input-icon {
  width: 18px;
  height: 18px;
  color: #94a3b8;
}

.code-row {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

.send-btn {
  flex-shrink: 0;
  width: 130px;
}

.login-btn {
  width: 100%;
  margin-top: 20px;
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
