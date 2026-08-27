import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { request } from '@/api/http';
import type { LoginResult } from '@app/shared';

/** 登录用户信息 */
export interface CurrentUser {
  id: string;
  nickname: string;
  phone: string;
  roles: string[];
}

const SESSION_KEY = 'web.sessionId';

/**
 * 会话 store：Redis session 登录态（sessionId + 用户信息），
 * 刷新页面从 localStorage 恢复 sessionId。
 */
export const useSessionStore = defineStore('session', () => {
  const sessionId = ref<string>(localStorage.getItem(SESSION_KEY) ?? '');
  const user = ref<CurrentUser | null>(null);

  const isLoggedIn = computed(() => sessionId.value.length > 0);

  /** 登录成功：保存会话 */
  function setSession(result: LoginResult): void {
    sessionId.value = result.sessionId;
    user.value = result.user;
    localStorage.setItem(SESSION_KEY, result.sessionId);
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

  /** 仅清空本地会话（不调接口） */
  function clearLocal(): void {
    sessionId.value = '';
    user.value = null;
    localStorage.removeItem(SESSION_KEY);
  }

  return { sessionId, user, isLoggedIn, setSession, logout, clearLocal };
});
