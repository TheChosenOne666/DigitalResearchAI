<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import TopNav from '@/components/TopNav.vue';
import PayMethodPicker from '@/components/PayMethodPicker.vue';
import {
  fetchPlans,
  fetchMemberStatus,
  createOrder,
  payOrder,
  mockPayOrder,
  setAutoRenew,
  money,
  dateOnly,
  type MemberLevel,
  type MemberPlanItem,
  type MemberPlanLevel,
  type MemberStatus,
  type PayChannel,
} from '@/api/member';

const router = useRouter();

/** 会员权益对比表（对齐原型 vipCompareHTML） */
const COMPARE_ROWS: Array<[string, string, string]> = [
  ['AI 智搜次数', '免费体验 1 次', '无限次'],
  ['数据分析工作台', '—', '全功能（筛选 / 表格 / 图表）'],
  ['成果导出 Word / CSV / PNG', '仅在线查看', '全部支持'],
  ['深度推理分析', '—', '支持'],
  ['知识库本地 / 混合检索', '基础', '全文优先'],
  ['历史记录与我的数据', '本机保存', '云端同步'],
  ['专属客服支持', '—', '1 对 1 服务'],
];

const loading = ref(true);
const levels = ref<MemberPlanLevel[]>([]);
const status = ref<MemberStatus | null>(null);
const activeLevel = ref<MemberLevel>('PRO');
const trialLimit = ref(1);

/** 支付弹窗 */
const payVisible = ref(false);
const payPlan = ref<MemberPlanItem | null>(null);
const payMethod = ref<PayChannel>('MOCK');
const paying = ref(false);
const renewSwitching = ref(false);

/** 当前标签页的等级分组 */
const currentGroup = computed<MemberPlanLevel | null>(
  () => levels.value.find((l) => l.level === activeLevel.value) ?? null,
);

/** 当前等级是否已是生效会员（决定按钮文案：开通 / 续费 / 切换升级） */
function buyText(plan: MemberPlanItem): string {
  const s = status.value;
  if (!s?.isMember) return '立即开通';
  if (s.level === activeLevel.value && s.cycle === plan.cycle) return '立即续费';
  return '切换 / 升级';
}

/** 是否为当前生效套餐 */
function isCurrent(plan: MemberPlanItem): boolean {
  const s = status.value;
  return !!s?.isMember && s.level === activeLevel.value && s.cycle === plan.cycle;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [planRes, st] = await Promise.all([fetchPlans(), fetchMemberStatus()]);
    levels.value = planRes.levels;
    trialLimit.value = planRes.trialLimit;
    status.value = st;
    // 已是会员时默认停在其等级页签
    if (st.isMember && (st.level === 'PRO' || st.level === 'ENTERPRISE')) {
      activeLevel.value = st.level;
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '会员信息加载失败');
  } finally {
    loading.value = false;
  }
}

function switchLevel(level: MemberLevel): void {
  activeLevel.value = level;
}

/** 打开支付确认弹窗 */
function buy(plan: MemberPlanItem): void {
  payPlan.value = plan;
  payMethod.value = 'MOCK';
  payVisible.value = true;
}

/** 确认支付：下单 → 发起支付 → 模拟渠道回调（与真实回调同一入账链路） */
async function confirmPay(): Promise<void> {
  const plan = payPlan.value;
  if (!plan || paying.value) return;
  paying.value = true;
  try {
    const order = await createOrder(plan.id, 'MOCK');
    await payOrder(order.orderNo, 'MOCK');
    await mockPayOrder(order.orderNo);
    ElMessage.success(`已开通 ${plan.name}，AI 智搜不限次数`);
    payVisible.value = false;
    await load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '支付失败，请稍后重试');
  } finally {
    paying.value = false;
  }
}

/** 连续包月自动续费开关 */
async function toggleAutoRenew(val: boolean | string | number): Promise<void> {
  if (renewSwitching.value) return;
  renewSwitching.value = true;
  try {
    const res = await setAutoRenew(val === true);
    if (status.value) status.value.autoRenew = res.autoRenew;
    ElMessage.success(res.autoRenew ? '已开启到期自动续费' : '已关闭到期自动续费');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '设置失败');
  } finally {
    renewSwitching.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="vip-shell">
    <TopNav />
    <div v-loading="loading" class="vip-page">
      <div class="vip-head">
        <h1>会员中心</h1>
        <p>开通会员，解锁 AI 智搜无限次使用与全部数据分析能力</p>
      </div>

      <!-- 会员状态卡（对齐原型 vipStatusHTML） -->
      <div v-if="status" class="vip-status">
        <div v-if="status.isMember" class="vip-status-card">
          <span class="vip-st-ic">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M3 8l4 3 5-6 5 6 4-3v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" fill="currentColor" />
            </svg>
          </span>
          <div class="vip-st-main">
            <b>{{ status.levelName }} · {{ status.cycleName }}</b>
            <span>
              会员有效期至 <b>{{ dateOnly(status.expireAt) }}</b>（剩余 {{ status.daysLeft }} 天）·
              期间 AI 智搜不限次数
            </span>
          </div>
          <div class="vip-st-actions">
            <el-switch
              v-if="status.cycle === 'MONTHLY'"
              :model-value="status.autoRenew"
              active-text="自动续费"
              :loading="renewSwitching"
              style="margin-right: 12px"
              @change="toggleAutoRenew"
            />
            <button class="btn primary" @click="router.push('/pay')">续费 / 升级</button>
          </div>
        </div>
        <div v-else class="vip-status-card" :class="{ 'is-expired': status.trialLeft === 0 }">
          <span class="vip-st-ic">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M3 8l4 3 5-6 5 6 4-3v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" fill="currentColor" />
            </svg>
          </span>
          <div class="vip-st-main">
            <b v-if="status.trialLeft === 0">免费体验已用完</b>
            <b v-else>当前为非会员 · 免费体验剩余 {{ status.trialLeft ?? trialLimit }} 次</b>
            <span>{{
              status.trialLeft === 0
                ? '开通会员后 AI 智搜不限次数，解锁全部数据分析能力'
                : '首次登录可免费体验 1 次智搜，体验完需开通会员'
            }}</span>
          </div>
          <div class="vip-st-actions">
            <button class="btn primary" @click="activeLevel = 'PRO'">立即开通</button>
          </div>
        </div>
      </div>

      <!-- 等级页签 -->
      <div class="vip-tabs">
        <button
          v-for="lv in levels"
          :key="lv.level"
          class="vip-tab"
          :class="{ active: activeLevel === lv.level }"
          @click="switchLevel(lv.level)"
        >
          {{ lv.levelName }}
        </button>
      </div>

      <!-- 滚动公告（对齐原型 vip-notice） -->
      <div class="vip-notice">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M4 9v6h3l5 4V5L7 9H4z" fill="currentColor" />
          <path d="M16 9.5a4 4 0 0 1 0 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
        <span>
          连续包月可随时取消 · 年付低至约 ¥{{ currentGroup?.plans.find((p) => p.cycle === 'YEAR')?.monthAmount ?? '—' }}/月 ·
          开通后 AI 智搜不限次数
        </span>
      </div>

      <!-- 三列套餐卡 -->
      <div class="vip-cards">
        <div
          v-for="plan in currentGroup?.plans ?? []"
          :key="plan.code"
          class="vip-card"
          :class="{ featured: plan.cycle === 'YEAR' }"
        >
          <span v-if="plan.badge" class="vip-c-badge">{{ plan.badge }}</span>
          <div class="vip-c-top">
            <span class="crown">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M3 8l4 3 5-6 5 6 4-3v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" fill="currentColor" />
              </svg>
            </span>
            <span class="vip-c-name">{{ plan.cycleName }}</span>
            <span class="vip-c-tag">{{ currentGroup?.tag }}</span>
          </div>
          <div class="vip-price">
            <span class="num">¥{{ plan.amount }}<i v-if="plan.cycle !== 'YEAR'">/月</i></span>
            <span v-if="plan.originAmount" class="origin">¥{{ plan.originAmount }}</span>
          </div>
          <div class="vip-c-sub">
            <template v-if="plan.cycle === 'YEAR'">约 ¥{{ plan.monthAmount }}/月</template>
            <template v-else-if="plan.cycle === 'MONTHLY'">每月自动续费，可随时取消</template>
            <template v-else>单次购买，随用随付</template>
          </div>
          <button class="vip-c-buy" :disabled="paying" @click="buy(plan)">
            {{ isCurrent(plan) ? '当前套餐 · 立即续费' : buyText(plan) }}
          </button>
          <ul class="vip-c-feats">
            <li v-for="f in plan.features" :key="f">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              {{ f }}
            </li>
          </ul>
        </div>
      </div>

      <!-- 权益对比表 -->
      <div class="vip-compare">
        <h3>会员权益对比</h3>
        <table class="cmp-table">
          <thead>
            <tr>
              <th>功能</th>
              <th>普通用户</th>
              <th>会员（专业版 / 企业版）</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in COMPARE_ROWS" :key="row[0]">
              <td>{{ row[0] }}</td>
              <td>{{ row[1] }}</td>
              <td class="ok">{{ row[2] }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 确认支付弹窗（对齐原型 formModal） -->
    <div v-if="payVisible" class="pay-dialog" @click.self="payVisible = false">
      <div class="pay-card">
        <button class="close-btn" aria-label="关闭" @click="payVisible = false">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
        </button>
        <div class="pay-title">确认支付</div>
        <div class="pay-body">
          <div class="pay-plan">{{ payPlan?.name }}</div>
          <div class="pay-amount">
            {{ money(payPlan?.priceCents ?? 0) }}
            <span v-if="payPlan && payPlan.cycle === 'YEAR'">/年</span>
            <span v-else>/月</span>
          </div>
          <div class="pay-tip">支付后立即生效 · AI 智搜不限次数</div>
          <PayMethodPicker v-model="payMethod" />
        </div>
        <div class="pay-actions">
          <button class="btn" @click="payVisible = false">取消</button>
          <button class="btn primary" :disabled="paying" @click="confirmPay">
            {{ paying ? '支付中…' : '确认支付' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vip-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f8fafc;
}

.vip-page {
  max-width: 1080px;
  width: 100%;
  margin: 0 auto;
  padding: 8px 24px 48px;
}

.vip-head {
  text-align: center;
  padding: 26px 0 6px;
}

.vip-head h1 {
  margin: 0 0 8px;
  font-size: 26px;
  letter-spacing: 1px;
  color: #0f172a;
}

.vip-head p {
  margin: 0;
  color: #64748b;
  font-size: 13px;
}

/* 状态卡 */
.vip-status {
  margin: 18px 0 6px;
}

.vip-status-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  border-radius: 14px;
  border: 1px solid #fde68a;
  background: linear-gradient(135deg, #fffbeb, #fef3c7);
}

.vip-status-card.is-expired {
  border-color: #e2e8f0;
  background: #f8fafc;
}

.vip-st-ic {
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: #fde68a;
  color: #b45309;
}

.vip-st-ic svg {
  width: 22px;
  height: 22px;
}

.vip-status-card.is-expired .vip-st-ic {
  background: #e2e8f0;
  color: #64748b;
}

.vip-st-main {
  flex: 1;
  min-width: 0;
}

.vip-st-main b {
  font-size: 15px;
  color: #0f172a;
}

.vip-st-main span {
  display: block;
  color: #64748b;
  font-size: 12px;
  margin-top: 3px;
}

.vip-st-actions {
  display: flex;
  align-items: center;
}

/* 页签 */
.vip-tabs {
  display: flex;
  gap: 10px;
  margin: 22px 0 14px;
  justify-content: center;
}

.vip-tab {
  padding: 9px 26px;
  border-radius: 22px;
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #64748b;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.vip-tab:hover {
  border-color: #2563eb;
  color: #2563eb;
}

.vip-tab.active {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
  box-shadow: 0 6px 16px rgba(37, 99, 235, 0.25);
}

/* 公告 */
.vip-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 10px;
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  color: #0369a1;
  font-size: 12.5px;
  margin-bottom: 22px;
}

.vip-notice svg {
  width: 15px;
  height: 15px;
  color: #0ea5e9;
  flex: 0 0 auto;
}

/* 套餐卡 */
.vip-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
}

.vip-card {
  position: relative;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  background: #fff;
  padding: 22px 20px 20px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.04);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.vip-card:hover {
  box-shadow: 0 10px 26px rgba(15, 23, 42, 0.09);
  transform: translateY(-2px);
}

.vip-card.featured {
  border-color: #f59e0b;
  box-shadow: 0 10px 26px rgba(217, 119, 6, 0.16);
}

.vip-c-badge {
  position: absolute;
  top: -11px;
  left: 50%;
  transform: translateX(-50%);
  padding: 3px 14px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  white-space: nowrap;
}

.vip-c-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.crown {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: #eff6ff;
  color: #2563eb;
}

.crown svg {
  width: 18px;
  height: 18px;
}

.vip-card.featured .crown {
  background: #fef3c7;
  color: #b45309;
}

.vip-c-name {
  font-size: 17px;
  font-weight: 700;
  color: #0f172a;
}

.vip-c-tag {
  margin-left: auto;
  font-size: 11px;
  color: #94a3b8;
}

.vip-price {
  margin: 10px 0 2px;
}

.vip-price .num {
  font-size: 30px;
  font-weight: 800;
  color: #0f172a;
}

.vip-price .num i {
  font-style: normal;
  font-size: 14px;
  color: #64748b;
  font-weight: 600;
}

.vip-price .origin {
  font-size: 12px;
  color: #94a3b8;
  text-decoration: line-through;
  margin-left: 6px;
}

.vip-c-sub {
  font-size: 12px;
  color: #64748b;
  margin: 2px 0 14px;
}

.vip-c-buy {
  display: block;
  width: 100%;
  padding: 11px 0;
  border-radius: 11px;
  border: 0;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  color: #fff;
  margin-bottom: 16px;
}

.vip-c-buy:hover {
  filter: brightness(1.07);
}

.vip-c-buy:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.vip-card.featured .vip-c-buy {
  background: linear-gradient(135deg, #f59e0b, #d97706);
}

.vip-c-feats {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 9px;
}

.vip-c-feats li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12.5px;
  color: #475569;
  line-height: 1.45;
}

.vip-c-feats svg {
  width: 14px;
  height: 14px;
  color: #16a34a;
  flex: 0 0 auto;
  margin-top: 2px;
}

/* 对比表 */
.vip-compare {
  margin-top: 36px;
}

.vip-compare h3 {
  font-size: 17px;
  margin: 0 0 14px;
  text-align: center;
  color: #0f172a;
}

.cmp-table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
  font-size: 13px;
}

.cmp-table th,
.cmp-table td {
  padding: 11px 14px;
  text-align: center;
  border-bottom: 1px solid #f1f5f9;
}

.cmp-table th {
  background: #f8fafc;
  color: #475569;
  font-weight: 600;
}

.cmp-table th:first-child,
.cmp-table td:first-child {
  text-align: left;
}

.cmp-table td.ok {
  color: #16a34a;
  font-weight: 600;
}

/* 支付弹窗 */
.pay-dialog {
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

.pay-card {
  position: relative;
  width: 400px;
  background: #fff;
  border-radius: 14px;
  border: 1px solid #eef2f7;
  box-shadow: 0 8px 30px rgba(30, 41, 59, 0.12);
  padding: 26px 28px 22px;
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

.pay-title {
  font-size: 17px;
  font-weight: 600;
  color: #0f172a;
  text-align: center;
  margin-bottom: 16px;
}

.pay-body {
  text-align: center;
}

.pay-plan {
  font-size: 14px;
  color: #64748b;
}

.pay-amount {
  font-size: 30px;
  font-weight: 800;
  color: #2563eb;
  margin: 8px 0;
}

.pay-amount span {
  font-size: 14px;
  color: #94a3b8;
  font-weight: 500;
}

.pay-tip {
  color: #94a3b8;
  font-size: 12px;
}

.pay-body :deep(.pm-wrap) {
  margin-top: 18px;
}

.pay-body :deep(.pay-warn) {
  text-align: left;
}

.pay-actions {
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

.btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

@media (max-width: 860px) {
  .vip-cards {
    grid-template-columns: 1fr;
  }
}
</style>
