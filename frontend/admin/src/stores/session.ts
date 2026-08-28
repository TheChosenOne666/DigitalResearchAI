import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { request, ApiError } from '@/api/http';
import { login as apiLogin, fetchMe } from '@/api/admin';
import type { AdminMenuGroup } from '@/api/admin';
import { ErrorCode } from '@app/shared';

/** 当前管理员用户信息 */
export interface AdminUser {
  id: string;
  nickname: string;
  phone: string;
  tenantId: string;
  tenantName: string;
  roles: string[];
}

const SESSION_KEY = 'admin.sessionId';

/**
 * 管理端会话 store：账密登录 → 写入 sessionId → 拉取 /admin/me 校验管理员角色与菜单。
 * 刷新页面从 localStorage 恢复 sessionId，路由守卫调用 ensureAdmin 恢复上下文。
 */
export const useSessionStore = defineStore('adminSession', () => {
  const sessionId = ref<string>(localStorage.getItem(SESSION_KEY) ?? '');
  const user = ref<AdminUser | null>(null);
  const roles = ref<string[]>([]);
  const menus = ref<AdminMenuGroup[]>([]);
  const loading = ref(false);

  const isLoggedIn = computed(() => sessionId.value.length > 0);

  /** 账密登录：成功后拉取管理员上下文；非管理员角色抛 2001 无权限 */
  async function login(phone: string, password: string): Promise<void> {
    const result = await apiLogin(phone, password);
    sessionId.value = result.sessionId;
    localStorage.setItem(SESSION_KEY, result.sessionId);
    await ensureAdmin();
  }

  /** 恢复/校验管理员上下文（登录后或刷新后由守卫调用） */
  async function ensureAdmin(): Promise<void> {
    loading.value = true;
    try {
      const me = await fetchMe();
      user.value = { ...me.user, roles: me.roles };
      roles.value = me.roles;
      menus.value = me.menus;
    } catch (e) {
      // 无权限（非管理员）/ 会话失效：清空本地会话，交由守卫跳登录
      if (e instanceof ApiError && (e.code === ErrorCode.FORBIDDEN || e.code === ErrorCode.UNAUTHORIZED)) {
        clearLocal();
      }
      throw e;
    } finally {
      loading.value = false;
    }
  }

  /** 登出：调接口销毁会话并清空本地（接口失败也强制清空） */
  async function logout(): Promise<void> {
    try {
      await request('/api/v1/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionId.value}` },
      });
    } catch {
      // 会话已失效等场景：本地照常清空
    }
    clearLocal();
  }

  /** 仅清空本地会话 */
  function clearLocal(): void {
    sessionId.value = '';
    user.value = null;
    roles.value = [];
    menus.value = [];
    localStorage.removeItem(SESSION_KEY);
  }

  return { sessionId, user, roles, menus, loading, isLoggedIn, login, ensureAdmin, logout, clearLocal };
});
