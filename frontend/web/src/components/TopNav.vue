<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import LoginDialog from '@/components/LoginDialog.vue';
import { useSessionStore } from '@/stores/session';
import { clearHistories, fetchHistories, type SessionListItem } from '@/api/search';
import { fetchMemberStatus, type MemberStatus } from '@/api/member';

const router = useRouter();
const route = useRoute();
const session = useSessionStore();

/** 登录弹窗 */
const showLogin = ref(false);

/** 历史记录下拉 */
const histOpen = ref(false);
const histLoading = ref(false);
const histories = ref<SessionListItem[]>([]);

/** 头像下拉 */
const userOpen = ref(false);

/** 当前激活导航（按路由路径） */
const activeNav = computed(() => {
  const p = route.path;
  if (p === '/' || p === '/search') return 'home';
  if (p.startsWith('/knowledge')) return 'kb';
  if (p.startsWith('/workspace')) return 'workspace';
  return '';
});

const nickname = computed(() => session.user?.nickname ?? '用户');
const avatarChar = computed(() => nickname.value.charAt(0));

/** 会员状态缓存（登录后拉取，用于头像旁会员徽章） */
const memberStatus = ref<MemberStatus | null>(null);
const isMember = computed(() => memberStatus.value?.isMember ?? false);
/** 徽章文案：会员显示等级名，否则「加入会员」 */
const memberBadgeText = computed(() => (isMember.value ? memberStatus.value!.levelName : '加入会员'));
/** 徽章悬停提示 */
const memberBadgeTitle = computed(() => {
  const m = memberStatus.value;
  if (m?.isMember && m.expireAt) {
    return `${m.levelName} · ${m.cycleName ?? ''} · ${m.expireAt.slice(0, 10)} 到期，点击查看 / 续费`;
  }
  return '开通会员，解锁 AI 智搜无限次使用';
});

/** 拉取会员状态（未登录则清空） */
async function loadMemberStatus(): Promise<void> {
  if (!session.isLoggedIn) {
    memberStatus.value = null;
    return;
  }
  try {
    memberStatus.value = await fetchMemberStatus();
  } catch {
    memberStatus.value = null;
  }
}

/** 点击会员徽章：未登录先弹登录框，已登录进会员中心 */
function goVip(): void {
  if (!session.isLoggedIn) {
    showLogin.value = true;
    return;
  }
  router.push('/vip');
}

/** 切换历史下拉（每次打开都重新拉取，保证新记录可见） */
async function toggleHist(): Promise<void> {
  histOpen.value = !histOpen.value;
  userOpen.value = false;
  if (histOpen.value && session.isLoggedIn) {
    histLoading.value = true;
    try {
      const data = await fetchHistories(1, 30);
      histories.value = data.items;
    } catch (e) {
      ElMessage.error(e instanceof Error ? e.message : '历史加载失败');
    } finally {
      histLoading.value = false;
    }
  }
}

/** 点击历史条目：有报告 → 报告详情页；待选择（有快照无报告）→ 回首页恢复选择态；其余（旧会话/中止失败）→ 重新检索 */
function runHist(item: SessionListItem): void {
  histOpen.value = false;
  if (item.reportId) {
    router.push(`/search/reports/${encodeURIComponent(item.id)}`);
  } else if (item.status === 'pending_selection') {
    router.push({ path: '/', query: { retrieval: item.id } });
  } else {
    router.push({ path: '/', query: { q: item.question } });
  }
}

/** 清空历史：二次确认 → 后端级联删除全部会话/报告/来源 */
async function onClearHistories(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '清空后将删除全部历史会话及已生成的报告（含来源卡），且不可恢复。确定清空？',
      '清空历史记录',
      { type: 'warning', confirmButtonText: '清空', cancelButtonText: '取消' },
    );
  } catch {
    return; // 用户取消
  }
  try {
    const { deleted } = await clearHistories();
    histories.value = [];
    ElMessage.success(deleted > 0 ? `已清空 ${deleted} 条历史记录` : '历史记录已为空');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '清空失败');
  }
}

function toggleUser(): void {
  userOpen.value = !userOpen.value;
  histOpen.value = false;
}

/** 头像菜单跳转（我的数据/我的报告） */
function goMine(path: string): void {
  userOpen.value = false;
  router.push(path);
}

async function onLogout(): Promise<void> {
  await session.logout();
  userOpen.value = false;
  ElMessage.success('已退出登录');
  if (route.path !== '/') router.push('/');
}

function closeMenus(e: MouseEvent): void {
  const el = e.target as HTMLElement;
  if (!el.closest('.tn-drop') && !el.closest('.nav-user')) {
    histOpen.value = false;
    userOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', closeMenus);
  if (session.isLoggedIn) loadMemberStatus();
});
onBeforeUnmount(() => document.removeEventListener('click', closeMenus));
// 登录态变化时同步会员徽章
watch(() => session.sessionId, () => loadMemberStatus());
</script>

<template>
  <header class="topnav">
    <div class="tn-inner">
      <div class="tn-brand" @click="router.push('/')" title="返回首页">
        <span class="brand-mark">AI</span>
        <span class="tn-title">AI数智研究平台</span>
      </div>

      <nav class="tn-nav">
        <a class="tn-item" :class="{ active: activeNav === 'home' }" @click="router.push('/')">
          首页
        </a>
        <a class="tn-item" :class="{ active: activeNav === 'kb' }" @click="router.push('/knowledge')">
          知识库
        </a>
        <a class="tn-item" :class="{ active: activeNav === 'workspace' }" @click="router.push('/workspace')">
          工作台
        </a>
        <div class="tn-drop">
          <a class="tn-item" :class="{ active: histOpen }" @click="toggleHist">
            <svg class="ic" viewBox="0 0 24 24" fill="none">
              <path d="M12 8v4l2.5 2.5M3.5 12a8.5 8.5 0 1 0 2.5-6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
            </svg>
            历史记录
            <svg class="chev" viewBox="0 0 24 24" fill="none">
              <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </a>
          <div v-if="histOpen" class="tn-menu" @click.stop>
            <div v-loading="histLoading" class="hist-list">
              <div v-if="!session.isLoggedIn" class="hist-gate">
                登录后查看历史记录
                <el-button type="primary" size="small" style="margin-top: 8px" @click="(showLogin = true), (histOpen = false)">
                  立即登录
                </el-button>
              </div>
              <div v-else-if="!histories.length" class="hist-empty">
                暂无历史记录<br /><span>提问后自动保存，便于二次复用</span>
              </div>
              <div v-else>
                <div class="hist-head">
                  <span>历史记录</span>
                  <a @click="onClearHistories">清空</a>
                </div>
                <div v-for="item in histories" :key="item.id" class="hist-item" @click="runHist(item)">
                  <div class="hist-q">{{ item.question }}</div>
                  <div class="hist-t">{{ new Date(item.createdAt).toLocaleString() }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <div class="tn-right">
        <span
          class="tn-pro"
          :class="isMember ? 'tn-member' : 'tn-join'"
          :title="memberBadgeTitle"
          @click="goVip"
        >
          <svg class="crown" viewBox="0 0 24 24" fill="none">
            <path d="m2 8 3.5 4L12 4l6.5 8L22 8l-1.7 11a2 2 0 0 1-2 1.8H5.7a2 2 0 0 1-2-1.8Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M5.5 19.5h13" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          {{ memberBadgeText }}
        </span>
        <template v-if="!session.isLoggedIn">
          <button class="tn-login-btn" @click="showLogin = true">
            <svg class="ic" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.7" />
              <path d="M4.5 20a7.5 7.5 0 0 1 15 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
            </svg>
            登录
          </button>
        </template>
        <div v-else class="nav-user" @click.stop>
          <div class="nu-wrap" @click="toggleUser">
            <span class="nu-avatar">{{ avatarChar }}</span>
            <span class="nu-name">{{ nickname }}</span>
            <svg class="chev" viewBox="0 0 24 24" fill="none">
              <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </div>
          <div v-if="userOpen" class="tn-menu user-menu" @click.stop>
            <div class="um-head">
              <span class="um-name">{{ nickname }}</span>
              <span class="um-phone">{{ session.user?.phone ?? '' }}</span>
            </div>
            <a class="um-item" @click="goMine('/my-data')">
              <svg class="um-ic" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.7" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.7" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.7" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.7" /></svg>
              我的数据
            </a>
            <a class="um-item" @click="goMine('/my-reports')">
              <svg class="um-ic" viewBox="0 0 24 24" fill="none"><path d="M6 3.5h9l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V5A1.5 1.5 0 0 1 6.5 3.5z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /><path d="M14.5 3.5V8H19" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /></svg>
              我的报告
            </a>
            <a class="um-item" @click="goMine('/vip')">
              <svg class="um-ic" viewBox="0 0 24 24" fill="none"><path d="M3 8l4 3 5-6 5 6 4-3v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /></svg>
              会员中心
            </a>
            <a class="um-item" @click="goMine('/pay')">
              <svg class="um-ic" viewBox="0 0 24 24" fill="none"><rect x="2.5" y="5.5" width="19" height="13" rx="2.5" stroke="currentColor" stroke-width="1.7" /><path d="M2.5 10h19" stroke="currentColor" stroke-width="1.7" /></svg>
              结算支付
            </a>
            <a class="um-item" @click="goMine('/billing')">
              <svg class="um-ic" viewBox="0 0 24 24" fill="none"><path d="M6 3.5h9l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V5A1.5 1.5 0 0 1 6.5 3.5z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /><path d="M9 12h6M9 16h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
              账单查询
            </a>
            <a class="um-item" @click="onLogout">退出登录</a>
          </div>
        </div>
      </div>
    </div>
  </header>

  <LoginDialog v-if="showLogin" @success="showLogin = false" @close="showLogin = false" />
</template>

<style scoped>
.topnav {
  position: sticky;
  top: 0;
  z-index: 100;
  height: 60px;
  background: #fff;
  border-bottom: 1px solid #eef2f7;
}

.tn-inner {
  height: 100%;
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 24px;
  display: flex;
  align-items: center;
  gap: 16px;
}

.tn-brand {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.brand-mark {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #2563eb;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tn-title {
  font-size: 16px;
  font-weight: 600;
  color: #0f172a;
  white-space: nowrap;
}

.tn-nav {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.tn-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 58px;
  padding: 0 14px;
  font-size: 14px;
  color: #475569;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}

.tn-item:hover {
  color: #2563eb;
}

.tn-item.active {
  color: #2563eb;
  font-weight: 600;
  border-bottom-color: #2563eb;
}

.ic {
  width: 15px;
  height: 15px;
}

.chev {
  width: 12px;
  height: 12px;
  color: #94a3b8;
}

.tn-drop {
  position: relative;
}

.tn-menu {
  position: absolute;
  top: 60px;
  left: 50%;
  transform: translateX(-50%);
  width: 320px;
  max-height: 360px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid #eef2f7;
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(30, 41, 59, 0.12);
  padding: 8px;
  z-index: 110;
}

.tn-right {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}

.tn-login-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 18px;
  border: none;
  border-radius: 8px;
  background: #2563eb;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}

.tn-login-btn:hover {
  background: #1d4ed8;
}

/* 头像旁会员徽章（对齐原型 .tn-pro） */
.tn-pro {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
}

.tn-pro .crown {
  width: 14px;
  height: 14px;
}

.tn-pro.tn-join {
  border: 1px solid #f59e0b;
  background: linear-gradient(135deg, #fef3c7, #fde68a);
  color: #92400e;
}

.tn-pro.tn-member {
  border: 1px solid #d97706;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #fff;
}

.tn-pro:hover {
  box-shadow: 0 2px 8px rgba(217, 119, 6, 0.25);
}

.nav-user {
  position: relative;
}

.nu-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.nu-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #2563eb;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nu-name {
  font-size: 14px;
  color: #334155;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-menu {
  width: 220px;
  left: auto;
  right: 0;
  transform: none;
}

.um-head {
  padding: 10px 12px;
  border-bottom: 1px solid #f1f5f9;
}

.um-name {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}

.um-phone {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: #94a3b8;
}

.um-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13.5px;
  color: #475569;
  cursor: pointer;
}

.um-item:hover {
  background: #f1f5f9;
}

.um-ic {
  width: 15px;
  height: 15px;
  color: #94a3b8;
  flex: 0 0 auto;
}

.hist-list {
  min-height: 80px;
}

.hist-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 8px 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: #64748b;
  border-bottom: 1px solid #f1f5f9;
}

.hist-head a {
  color: #2563eb;
  cursor: pointer;
  font-weight: 400;
}

.hist-item {
  padding: 9px 8px;
  border-radius: 8px;
  cursor: pointer;
}

.hist-item:hover {
  background: #f8fafc;
}

.hist-q {
  font-size: 13.5px;
  color: #1e293b;
  line-height: 1.5;
}

.hist-t {
  margin-top: 3px;
  font-size: 11.5px;
  color: #94a3b8;
}

.hist-gate,
.hist-empty {
  text-align: center;
  padding: 24px 10px;
  color: #94a3b8;
  font-size: 13px;
}

.hist-empty span {
  font-size: 11px;
}
</style>
