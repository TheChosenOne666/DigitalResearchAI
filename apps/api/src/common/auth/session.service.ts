import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';

/** 会话中存储的用户上下文 */
export interface SessionContext {
  /** 用户 ID */
  userId: string;
  /** 租户 ID */
  tenantId: string;
  /** 角色编码列表（每次请求现查现续期，角色变更即时生效由 Guard 刷新） */
  roles: string[];
  /** 会话创建时间（毫秒） */
  createdAt: number;
}

/**
 * 会话底层 KV 存储（Redis 实现 + 测试内存实现）。
 * 需支持：String 读写/TTL、Set 增删查（用于 user:sids:{uid} 在线会话索引）。
 */
export interface SessionStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /** 滑动续期：键存在时重设 TTL，返回是否成功 */
  expire(key: string, ttlSeconds: number): Promise<boolean>;
  /** 集合添加成员（集合不存在时创建并设置 TTL） */
  sadd(key: string, member: string, ttlSeconds: number): Promise<void>;
  /** 集合移除成员 */
  srem(key: string, member: string): Promise<void>;
  /** 集合全量成员 */
  smembers(key: string): Promise<string[]>;
}

/** 会话 TTL：7 天（滑动续期） */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Redis session 会话服务（对齐 docs/03-方案设计.md 2.5）：
 * - `sess:{sid}` 存用户上下文 JSON，TTL 7 天滑动续期
 * - `user:sids:{uid}` 集合索引用户全部在线会话，支持踢下线/在线设备管理
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(private readonly store: SessionStore) {}

  private sessKey(sid: string): string {
    return `sess:${sid}`;
  }

  private sidsKey(userId: string): string {
    return `user:sids:${userId}`;
  }

  /** 登录成功后创建会话，返回 sessionId（crypto 随机 32 字节 base64url） */
  async createSession(ctx: Omit<SessionContext, 'createdAt'>): Promise<string> {
    const sid = randomBytes(32).toString('base64url');
    await this.store.set(
      this.sessKey(sid),
      JSON.stringify({ ...ctx, createdAt: Date.now() } satisfies SessionContext),
      SESSION_TTL_SECONDS,
    );
    await this.store.sadd(this.sidsKey(ctx.userId), sid, SESSION_TTL_SECONDS);
    this.logger.log(`会话已创建: userId=${ctx.userId}`);
    return sid;
  }

  /**
   * 校验会话并滑动续期（Guard 每请求调用）。
   * @returns 有效返回用户上下文；会话不存在/过期返回 null
   */
  async resolveSession(sid: string): Promise<SessionContext | null> {
    if (!sid) return null;
    const raw = await this.store.get(this.sessKey(sid));
    if (!raw) return null;
    // 滑动续期：只要会话持续活跃就不掉线
    await this.store.expire(this.sessKey(sid), SESSION_TTL_SECONDS);
    return JSON.parse(raw) as SessionContext;
  }

  /** 登出/销毁单个会话（幂等，不存在时静默成功） */
  async destroySession(sid: string): Promise<void> {
    const raw = await this.store.get(this.sessKey(sid));
    await this.store.del(this.sessKey(sid));
    if (raw) {
      const ctx = JSON.parse(raw) as SessionContext;
      await this.store.srem(this.sidsKey(ctx.userId), sid);
    }
  }

  /** 踢下线：销毁用户全部在线会话，返回销毁数量（管理端/安全处置用） */
  async kickUser(userId: string): Promise<number> {
    const sids = await this.store.smembers(this.sidsKey(userId));
    for (const sid of sids) {
      await this.store.del(this.sessKey(sid));
    }
    await this.store.del(this.sidsKey(userId));
    if (sids.length > 0) {
      this.logger.warn(`用户被踢下线: userId=${userId} 会话数=${sids.length}`);
    }
    return sids.length;
  }

  /** 刷新会话中的角色信息（角色变更即时生效） */
  async refreshRoles(sid: string, roles: string[]): Promise<void> {
    const ctx = await this.resolveSession(sid);
    if (!ctx) return;
    await this.store.set(this.sessKey(sid), JSON.stringify({ ...ctx, roles }), SESSION_TTL_SECONDS);
  }
}
