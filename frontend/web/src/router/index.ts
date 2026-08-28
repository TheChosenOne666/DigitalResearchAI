import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '@/views/HomeView.vue';
import LoginView from '@/views/LoginView.vue';
import KnowledgeView from '@/views/KnowledgeView.vue';
import WorkspaceView from '@/views/WorkspaceView.vue';
import AnalyzeResultView from '@/views/AnalyzeResultView.vue';
import { useSessionStore } from '@/stores/session';

/** 路由元信息扩展：requiresAuth=true 表示该路由需登录 */
declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // 首页 = AI 智搜（已合并）：访客可看落地页，检索需登录（对齐原型 9.31 访客模式）
    { path: '/', name: 'home', component: HomeView, meta: { requiresAuth: false } },
    { path: '/login', name: 'login', component: LoginView, meta: { requiresAuth: false } },
    // M2 智搜已并入首页，旧 /search 重定向回首页
    { path: '/search', redirect: '/' },
    // M3 知识库页（受登录门禁保护，对齐原型 9.31）
    { path: '/knowledge', name: 'knowledge', component: KnowledgeView, meta: { requiresAuth: true } },
    // M4.1 数据工作台（受登录门禁保护）
    { path: '/workspace', name: 'workspace', component: WorkspaceView, meta: { requiresAuth: true } },
    // M4.3 分析结果页（受登录门禁保护）
    {
      path: '/workspace/analyze/:id',
      name: 'analyze-result',
      component: AnalyzeResultView,
      meta: { requiresAuth: true },
    },
  ],
});

/**
 * 登录门禁守卫（对齐原型 9.31 访客模式）：
 * 受保护路由（meta.requiresAuth=true）未登录 → 跳 /login，并带 redirect 参数回原路径。
 * M2 智搜页上线后标 requiresAuth=true 即自动生效，无需回头改守卫。
 */
router.beforeEach((to) => {
  if (to.meta.requiresAuth) {
    const session = useSessionStore();
    if (!session.isLoggedIn) {
      return { name: 'login', query: { redirect: to.fullPath } };
    }
  }
  return true;
});

export default router;
