<script setup lang="ts">
import { computed } from 'vue';

/** 工作台左侧多级筛选面板：关键词/年份/国家选择，状态由父组件持有（v-model + 事件回传） */

const props = defineProps<{
  /** 国家选项 = 内置国家 + 上传实体 */
  countryOptions: string[];
  selectedCountries: string[];
  /** 数据来源标注 */
  sourceLabel: string;
}>();

const keyword = defineModel<string>('keyword', { required: true });
const yearFrom = defineModel<number>('yearFrom', { required: true });
const yearTo = defineModel<number>('yearTo', { required: true });

const emit = defineEmits<{
  /** 年份输入变更（合法性钳制与防抖刷新由父组件处理） */
  'year-change': [];
  'toggle-country': [name: string];
  'select-all': [];
  'clear-all': [];
}>();

const selCount = computed(() => props.selectedCountries.length);
</script>

<template>
  <aside class="ws-fp">
    <div class="fp-head">
      <b>多级筛选</b>
      <span class="cnt">已选 {{ selCount }}</span>
    </div>

    <div class="fp-batch">
      <button @click="emit('clear-all')">清空选中</button>
      <button @click="emit('select-all')">全选国家</button>
    </div>

    <div class="fp-search">
      <input v-model="keyword" placeholder="关键词检索国家/地区…" />
    </div>

    <div class="fp-group">
      <div class="fp-title">时间（年份）</div>
      <div class="fp-year">
        <input v-model.number="yearFrom" type="number" min="1990" max="2100" @change="emit('year-change')" />
        <span>—</span>
        <input v-model.number="yearTo" type="number" min="1990" max="2100" @change="emit('year-change')" />
      </div>
    </div>

    <div class="fp-group">
      <div class="fp-title">国家 / 地区 <span class="cnt">{{ selCount }}/{{ countryOptions.length }}</span></div>
      <div class="fp-list">
        <label
          v-for="c in countryOptions"
          :key="c"
          class="fp-item"
          :class="{ on: selectedCountries.includes(c) }"
        >
          <input type="checkbox" :checked="selectedCountries.includes(c)" @change="emit('toggle-country', c)" />
          <span>{{ c }}</span>
        </label>
      </div>
    </div>

    <div class="fp-group">
      <div class="fp-title">数据来源</div>
      <div class="fp-src">{{ sourceLabel }}</div>
    </div>
  </aside>
</template>

<style scoped>
.ws-fp {
  flex: 0 0 240px;
  min-width: 0;
  padding: 14px;
  background: #fff;
  border-right: 1px solid #eef2f7;
  overflow-y: auto;
}

.fp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  font-size: 14px;
  color: #0f172a;
}

.fp-head .cnt {
  font-size: 11px;
  color: #64748b;
  font-weight: 400;
}

.fp-batch {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.fp-batch button {
  flex: 1;
  height: 28px;
  border: 1px solid #e2e8f0;
  border-radius: 7px;
  background: #fff;
  color: #475569;
  font-size: 12px;
  cursor: pointer;
}

.fp-batch button:hover {
  border-color: #2563eb;
  color: #2563eb;
}

.fp-search input {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 12.5px;
  outline: none;
  box-sizing: border-box;
}

.fp-search input:focus {
  border-color: #2563eb;
}

.fp-group {
  margin-top: 16px;
}

.fp-title {
  font-size: 12px;
  font-weight: 700;
  color: #64748b;
  margin-bottom: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.fp-title .cnt {
  font-size: 11px;
  font-weight: 400;
  color: #94a3b8;
}

.fp-year {
  display: flex;
  align-items: center;
  gap: 6px;
}

.fp-year input {
  width: 100%;
  height: 30px;
  padding: 0 8px;
  border: 1px solid #e2e8f0;
  border-radius: 7px;
  font-size: 12.5px;
  outline: none;
  box-sizing: border-box;
}

.fp-year span {
  color: #94a3b8;
  font-size: 12px;
}

.fp-list {
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.fp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 7px;
  font-size: 13px;
  color: #334155;
  cursor: pointer;
}

.fp-item:hover {
  background: #f1f5f9;
}

.fp-item.on {
  background: #e9effd;
  color: #2563eb;
}

.fp-item input {
  accent-color: #2563eb;
}

.fp-src {
  font-size: 12.5px;
  color: #64748b;
  padding: 6px 8px;
  background: #f8fafc;
  border-radius: 7px;
}
</style>
