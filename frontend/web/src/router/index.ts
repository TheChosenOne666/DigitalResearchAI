import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '@/views/HomeView.vue';
import LoginView from '@/views/LoginView.vue';
import SearchView from '@/views/SearchView.vue';
import KnowledgeView from '@/views/KnowledgeView.vue';
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
    // 落地页 / 登录页：访客可访问（公开）
    { path: '/', name: 'home', component: HomeView, meta: { requiresAuth: false } },
    { path: '/login', name: 'login', component: LoginView, meta: { requiresAuth: false } },
    // M2 智搜核心页（受登录门禁保护）
    { path: '/search', name: 'search', component: SearchView, meta: { requiresAuth: true } },
    // M3 知识库页（受登录门禁保护）
    { path: '/knowledge', name: 'knowledge', component: KnowledgeView, meta: { requiresAuth: true } },
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
