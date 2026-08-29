import { createRouter, createWebHistory } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useSessionStore } from '@/stores/session';
import AdminLayout from '@/layouts/AdminLayout.vue';
import LoginView from '@/views/LoginView.vue';
import DashboardView from '@/views/DashboardView.vue';
import UsersView from '@/views/UsersView.vue';
import MembersView from '@/views/MembersView.vue';
import RolesView from '@/views/RolesView.vue';
import IndicatorsView from '@/views/IndicatorsView.vue';
import DictsView from '@/views/DictsView.vue';
import DatasetsView from '@/views/DatasetsView.vue';
import ImportsView from '@/views/ImportsView.vue';
import NoticesView from '@/views/NoticesView.vue';
import SearchOpsView from '@/views/SearchOpsView.vue';
import TasksView from '@/views/TasksView.vue';
import ConfigsView from '@/views/ConfigsView.vue';
import AuditView from '@/views/AuditView.vue';
import MonitorView from '@/views/MonitorView.vue';
import BackupView from '@/views/BackupView.vue';
import KbReviewView from '@/views/KbReviewView.vue';
import KbCategoryView from '@/views/KbCategoryView.vue';
import KbPermissionView from '@/views/KbPermissionView.vue';
import KbIndexView from '@/views/KbIndexView.vue';
import OrdersView from '@/views/OrdersView.vue';

/** 仅平台管理员 */
const PLATFORM = ['PLATFORM_ADMIN'];
/** 平台管理员 + 数据管理员 */
const PLATFORM_DATA = ['PLATFORM_ADMIN', 'DATA_ADMIN'];

/** 增强路由元信息：标题 + 可访问角色（守卫校验） */
declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    roles?: string[];
  }
}

/**
 * 管理端路由（M6）：/login 公开，其余挂在 AdminLayout 下按 4.2 权限矩阵声明 roles。
 * 20 个功能视图已全部落地（M6.2~M6.5 分批替换占位）。
 */
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView, meta: { title: '登录' } },
    {
      path: '/',
      component: AdminLayout,
      redirect: '/dashboard',
      children: [
        { path: 'dashboard', name: 'dashboard', component: DashboardView, meta: { title: '平台总览', roles: PLATFORM_DATA } },
        // 组织用户
        { path: 'users', component: UsersView, meta: { title: '用户管理', roles: PLATFORM } },
        { path: 'members', component: MembersView, meta: { title: '会员管理', roles: PLATFORM } },
        { path: 'roles', component: RolesView, meta: { title: '角色权限', roles: PLATFORM } },
        // 数据资源
        { path: 'indicators', component: IndicatorsView, meta: { title: '指标管理', roles: PLATFORM_DATA } },
        { path: 'dicts', component: DictsView, meta: { title: '字典管理', roles: PLATFORM_DATA } },
        { path: 'datasets', component: DatasetsView, meta: { title: '数据集管理', roles: PLATFORM_DATA } },
        // 数据治理
        { path: 'imports', component: ImportsView, meta: { title: '数据接入审核', roles: PLATFORM_DATA } },
        // 运营管理
        { path: 'notices', component: NoticesView, meta: { title: '消息管理', roles: PLATFORM } },
        { path: 'search-ops', component: SearchOpsView, meta: { title: '搜索词管理', roles: PLATFORM } },
        // 任务中心
        { path: 'tasks', component: TasksView, meta: { title: '任务管理', roles: PLATFORM_DATA } },
        // 系统管理
        { path: 'config', component: ConfigsView, meta: { title: '参数配置', roles: PLATFORM } },
        { path: 'audit', component: AuditView, meta: { title: '审计日志', roles: PLATFORM } },
        { path: 'monitor', component: MonitorView, meta: { title: '运行监控', roles: PLATFORM } },
        { path: 'backup', component: BackupView, meta: { title: '数据备份', roles: PLATFORM } },
        // 知识库管理
        { path: 'kb/review', component: KbReviewView, meta: { title: '入库审核', roles: PLATFORM } },
        { path: 'kb/category', component: KbCategoryView, meta: { title: '类目管理', roles: PLATFORM } },
        { path: 'kb/permission', component: KbPermissionView, meta: { title: '知识权限', roles: PLATFORM } },
        { path: 'kb/index', component: KbIndexView, meta: { title: '索引管理', roles: PLATFORM } },
        // 支付中心
        { path: 'orders', component: OrdersView, meta: { title: '订单与支付配置', roles: PLATFORM } },
      ],
    },
  ],
});

/** 路由守卫：登录校验 + 管理员上下文恢复 + 角色校验 */
router.beforeEach(async (to) => {
  const store = useSessionStore();

  if (to.path === '/login') {
    return store.isLoggedIn ? '/dashboard' : true;
  }

  if (!store.isLoggedIn) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }

  // 恢复管理员上下文（首次进入 / 刷新页面）
  if (!store.user) {
    try {
      await store.ensureAdmin();
    } catch {
      return { path: '/login', query: { redirect: to.fullPath } };
    }
  }

  // 角色校验：无权限跳回看板并提示
  const required = to.meta.roles as string[] | undefined;
  if (required && required.length > 0 && !required.some((r) => store.roles.includes(r))) {
    ElMessage.error('无权限访问该页面');
    return '/dashboard';
  }

  return true;
});

export default router;
