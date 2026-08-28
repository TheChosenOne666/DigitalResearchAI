<script setup lang="ts">
import type { PayChannel } from '@/api/member';

/** 支付方式（MOCK 为已接入的开发联调渠道，其余待接入） */
const METHODS: Array<{ value: PayChannel; label: string; ready: boolean }> = [
  { value: 'MOCK', label: '模拟支付', ready: true },
  { value: 'WECHAT', label: '微信支付', ready: false },
  { value: 'ALIPAY', label: '支付宝', ready: false },
];

const model = defineModel<PayChannel>({ required: true });
</script>

<template>
  <div class="pm-wrap">
    <div class="pay-methods">
      <button
        v-for="m in METHODS"
        :key="m.value"
        class="pay-method"
        :class="{ sel: model === m.value }"
        @click="model = m.value"
      >
        {{ m.label }}
        <span v-if="!m.ready" class="m-tag">待接入</span>
      </button>
    </div>
    <div v-if="model !== 'MOCK'" class="pay-warn">
      该渠道尚未接入，本次将以模拟支付完成（订单与入账链路与真实渠道一致）
    </div>
  </div>
</template>

<style scoped>
.pay-methods {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.pay-method {
  position: relative;
  padding: 10px 4px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  font-size: 12.5px;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
}

.pay-method.sel {
  border-color: #2563eb;
  color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
}

.m-tag {
  display: block;
  margin-top: 2px;
  font-size: 10px;
  font-weight: 400;
  color: #94a3b8;
}

.pay-warn {
  margin-top: 10px;
  font-size: 11.5px;
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  padding: 8px 10px;
}
</style>
