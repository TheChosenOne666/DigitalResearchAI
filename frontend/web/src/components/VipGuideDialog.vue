<script setup lang="ts">
/**
 * 免费体验配额耗尽引导（M5.3）：智搜被 4003 拦截时弹出，引导前往会员中心开通。
 */
const emit = defineEmits<{ close: []; goVip: [] }>();
</script>

<template>
  <div class="guide-dialog" @click.self="emit('close')">
    <div class="guide-card">
      <button class="close-btn" aria-label="关闭" @click="emit('close')">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
      </button>

      <span class="guide-ic">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M3 8l4 3 5-6 5 6 4-3v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" fill="currentColor" />
        </svg>
      </span>

      <div class="guide-title">免费体验已用完</div>
      <div class="guide-desc">开通会员后 AI 智搜不限次数，并解锁全部数据分析能力</div>

      <ul class="guide-feats">
        <li>AI 智搜无限次，无体验上限</li>
        <li>数据分析工作台全功能 + 成果导出</li>
        <li>知识库全文检索 · 历史记录云端同步</li>
      </ul>

      <div class="guide-actions">
        <button class="btn" @click="emit('close')">稍后再说</button>
        <button class="btn primary" @click="emit('goVip')">查看会员方案</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.guide-dialog {
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

.guide-card {
  position: relative;
  width: 380px;
  background: #fff;
  border-radius: 14px;
  border: 1px solid #eef2f7;
  box-shadow: 0 8px 30px rgba(30, 41, 59, 0.12);
  padding: 30px 28px 24px;
  text-align: center;
}

.close-btn {
  position: absolute;
  top: 14px;
  right: 14px;
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

.guide-ic {
  display: grid;
  width: 52px;
  height: 52px;
  margin: 0 auto 14px;
  place-items: center;
  border-radius: 14px;
  background: linear-gradient(135deg, #fef3c7, #fde68a);
  color: #b45309;
}

.guide-ic svg {
  width: 26px;
  height: 26px;
}

.guide-title {
  font-size: 17px;
  font-weight: 600;
  color: #0f172a;
}

.guide-desc {
  margin-top: 6px;
  font-size: 13px;
  color: #64748b;
  line-height: 1.6;
}

.guide-feats {
  list-style: none;
  margin: 16px 0 0;
  padding: 14px 16px;
  text-align: left;
  background: #f8fafc;
  border-radius: 10px;
  display: grid;
  gap: 8px;
}

.guide-feats li {
  position: relative;
  padding-left: 18px;
  font-size: 12.5px;
  color: #475569;
}

.guide-feats li::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 6px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #2563eb;
}

.guide-actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}

.btn {
  flex: 1;
  height: 40px;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #475569;
  font-size: 14px;
  cursor: pointer;
}

.btn.primary {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
  font-weight: 600;
}

.btn.primary:hover {
  background: #1d4ed8;
}
</style>
