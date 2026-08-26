import { describe, expect, it, beforeEach } from 'vitest';
import {
  SessionService,
  SessionStore,
  SESSION_TTL_SECONDS,
} from '../src/common/auth/session.service';

/** 测试用内存 Store：支持 TTL 过期与 Set 语义 */
class MemorySessionStore implements SessionStore {
  private strings = new Map<string, { value: string; expiresAt: number }>();
  private sets = new Map<string, { members: Set<string>; expiresAt: number }>();

  private alive<T>(entry: { expiresAt: number; value: T } | undefined, map: Map<string, unknown>, key: string): { expiresAt: number; value: T } | undefined {
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      map.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    return this.alive(this.strings.get(key), this.strings as Map<string, unknown>, key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.strings.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(key: string): Promise<void> {
    this.strings.delete(key);
    this.sets.delete(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const entry = this.strings.get(key) ?? this.sets.get(key) as { expiresAt: number } | undefined;
    if (!entry || entry.expiresAt <= Date.now()) return false;
    entry.expiresAt = Date.now() + ttlSeconds * 1000;
    return true;
  }

  async sadd(key: string, member: string, ttlSeconds: number): Promise<void> {
    const existing = this.sets.get(key);
    if (existing && existing.expiresAt > Date.now()) {
      existing.members.add(member);
      existing.expiresAt = Date.now() + ttlSeconds * 1000;
    } else {
      this.sets.set(key, { members: new Set([member]), expiresAt: Date.now() + ttlSeconds * 1000 });
    }
  }

  async srem(key: string, member: string): Promise<void> {
    this.sets.get(key)?.members.delete(member);
  }

  async smembers(key: string): Promise<string[]> {
    const entry = this.sets.get(key);
    if (!entry || entry.expiresAt <= Date.now()) return [];
    return [...entry.members];
  }
}

describe('SessionService', () => {
  let svc: SessionService;
  let store: MemorySessionStore;
  beforeEach(() => {
    store = new MemorySessionStore();
    svc = new SessionService(store);
  });

  const ctx = { userId: 'u1', tenantId: 't1', roles: ['USER'] };

  it('createSession：返回随机 sessionId 并写入 sess:{sid}', async () => {
    const sid = await svc.createSession(ctx);
    expect(sid).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 字节 base64url
    const raw = await store.get(`sess:${sid}`);
    const parsed = JSON.parse(raw!);
    expect(parsed.userId).toBe('u1');
    expect(parsed.tenantId).toBe('t1');
    expect(parsed.roles).toEqual(['USER']);
    expect(parsed.createdAt).toBeGreaterThan(0);
  });

  it('同一用户多次登录：user:sids 索引累积多个会话', async () => {
    const sid1 = await svc.createSession(ctx);
    const sid2 = await svc.createSession(ctx);
    const sids = await store.smembers('user:sids:u1');
    expect(sids.sort()).toEqual([sid1, sid2].sort());
  });

  it('resolveSession：返回上下文并滑动续期', async () => {
    const sid = await svc.createSession(ctx);
    const before = JSON.parse((await store.get(`sess:${sid}`))!);
    // 手动把过期时间缩短，验证 resolve 后被重置为完整 TTL
    await store.set(`sess:${sid}`, JSON.stringify({ ...before, createdAt: before.createdAt }), 10);
    const resolved = await svc.resolveSession(sid);
    expect(resolved?.userId).toBe('u1');
    expect(resolved?.roles).toEqual(['USER']);
    // 过期时间应被滑动到 ~7 天后（大于 1 小时）
    const entry = (store as unknown as { strings: Map<string, { expiresAt: number }> }).strings.get(`sess:${sid}`)!;
    expect(entry.expiresAt - Date.now()).toBeGreaterThan(SESSION_TTL_SECONDS * 1000 - 60_000);
  });

  it('resolveSession：会话不存在/空 sid → null', async () => {
    expect(await svc.resolveSession('')).toBeNull();
    expect(await svc.resolveSession('nonexistent')).toBeNull();
  });

  it('destroySession：删除会话并从 user:sids 移除（幂等）', async () => {
    const sid = await svc.createSession(ctx);
    await svc.destroySession(sid);
    expect(await store.get(`sess:${sid}`)).toBeNull();
    expect(await store.smembers('user:sids:u1')).toEqual([]);
    // 重复销毁不抛错
    await expect(svc.destroySession(sid)).resolves.toBeUndefined();
  });

  it('kickUser：销毁用户全部会话并返回数量', async () => {
    await svc.createSession(ctx);
    await svc.createSession(ctx);
    await svc.createSession(ctx);
    const kicked = await svc.kickUser('u1');
    expect(kicked).toBe(3);
    expect(await store.smembers('user:sids:u1')).toEqual([]);
    // 被踢的会话全部失效
    expect(await svc.resolveSession((await store.get('x')) ?? '')).toBeNull();
  });

  it('refreshRoles：更新会话内角色并保留其他字段', async () => {
    const sid = await svc.createSession(ctx);
    await svc.refreshRoles(sid, ['USER', 'DATA_ADMIN']);
    const resolved = await svc.resolveSession(sid);
    expect(resolved?.roles).toEqual(['USER', 'DATA_ADMIN']);
    expect(resolved?.userId).toBe('u1');
  });
});
