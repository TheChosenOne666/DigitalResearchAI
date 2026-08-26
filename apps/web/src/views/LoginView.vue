<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { request } from '@/api/http';
import type { HealthData } from '@app/shared';

type ServiceStatus = 'checking' | 'ok' | 'degraded' | 'down';

const activeTab = ref('sms');
const smsForm = reactive({ phone: '', code: '' });
const pwdForm = reactive({ account: '', password: '' });

const serviceStatus = ref<ServiceStatus>('checking');
const serviceDetail = ref('');
const serviceUptime = ref(0);

const statusMeta = computed(() => {
  switch (serviceStatus.value) {
    case 'checking':
      return { color: '#94a3b8', text: '检测服务状态…' };
    case 'ok':
      return { color: '#10b981', text: '服务正常' };
    case 'degraded':
      return { color: '#f59e0b', text: `服务降级（${serviceDetail.value}）` };
    default:
      return { color: '#ef4444', text: '服务不可用' };
  }
});

onMounted(async () => {
  try {
    const data = await request<HealthData>('/api/v1/health?verbose=true');
    serviceUptime.value = data.uptime;
    if (data.status === 'ok') {
      serviceStatus.value = 'ok';
    } else {
      const downNames: Record<string, string> = {
        postgres: 'PostgreSQL',
        redis: 'Redis',
        qdrant: 'Qdrant',
      };
      const down = Object.entries(data.checks ?? {})
        .filter(([, v]) => v === 'down')
        .map(([k]) => downNames[k] ?? k);
      serviceDetail.value = down.join('、') + ' 不可用';
      serviceStatus.value = 'degraded';
    }
  } catch {
    serviceStatus.value = 'down';
  }
});

function onSendCode() {
  if (!/^1\d{10}$/.test(smsForm.phone)) {
    ElMessage.warning('请输入正确的手机号');
    return;
  }
  ElMessage.info('验证码服务将在认证里程碑（M1）接入');
}

function onLogin() {
  ElMessage.info('登录功能将在认证里程碑（M1）接入');
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="brand">
        <svg class="brand-logo" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="7" fill="#2563EB" />
          <path
            d="M14 6.5a7.5 7.5 0 1 0 4.7 13.35l4.22 4.22a1.2 1.2 0 0 0 1.7-1.7l-4.22-4.22A7.5 7.5 0 0 0 14 6.5Zm-3.2 4.3h2v3.2h3.2v2h-3.2v3.2h-2v-3.2H7.6v-2h3.2v-3.2Z"
            fill="#fff"
          />
        </svg>
        <div>
          <div class="brand-name">AI数智研究平台</div>
          <div class="brand-sub">一站式数据智能搜索 · 知识库 · 分析报告</div>
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
            <el-button size="large" class="send-btn" @click="onSendCode">获取验证码</el-button>
          </div>
        </el-tab-pane>

        <el-tab-pane label="账号密码登录" name="pwd">
          <el-input v-model="pwdForm.account" size="large" placeholder="请输入账号 / 手机号">
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

      <el-button type="primary" size="large" class="login-btn" @click="onLogin">登 录</el-button>
      <div class="agreement">登录即同意《服务协议》与《隐私政策》</div>

      <div class="service-status">
        <span class="status-dot" :style="{ background: statusMeta.color }" />
        <span class="status-text">
          {{ statusMeta.text }}
          <template v-if="serviceStatus === 'ok' && serviceUptime">（已运行 {{ serviceUptime }}s）</template>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.login-card {
  width: 420px;
  background: #fff;
  border-radius: 14px;
  border: 1px solid #eef2f7;
  box-shadow: 0 8px 30px rgba(30, 41, 59, 0.06);
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
}

.brand-sub {
  margin-top: 4px;
  font-size: 12px;
  color: #64748b;
}

.login-tabs {
  margin-bottom: 8px;
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
  width: 116px;
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

.service-status {
  margin-top: 22px;
  padding-top: 16px;
  border-top: 1px solid #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-text {
  font-size: 12px;
  color: #64748b;
}
</style>
