import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { RateLimitStore, type TokenBucketOptions } from '../src/common/rate-limit/rate-limit.store';
import { RateLimitService } from '../src/common/rate-limit/rate-limit.service';
import { RateLimitGuard } from '../src/common/rate-limit/rate-limit.guard';
import { ErrorCode } from '@app/shared';

/** 内存版限流存储：与 Redis 实现同语义，供单测断言令牌桶/并发计数行为 */
class MemoryRateLimitStore extends RateLimitStore {
  readonly buckets = new Map<string, { tokens: number; ts: number }>();
  readonly counters = new Map<string, number>();
  readonly tokenKeys: string[] = [];

  async takeToken(key: string, opts: TokenBucketOptions): Promise<boolean> {
    this.tokenKeys.push(key);
    const now = opts.now ?? Date.now();
    const { burst, rate } = opts;
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: burst, ts: now };
      this.buckets.set(key, b);
    } else {
      const elapsed = (now - b.ts) / 1000;
      if (elapsed > 0) {
        b.tokens = Math.min(burst, b.tokens + elapsed * rate);
        b.ts = now;
      }
    }
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return true;
    }
    return false;
  }

  async incrWithTtl(key: string): Promise<number> {
    const n = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, n);
    return n;
  }

  async decrToZero(key: string): Promise<number> {
    const n = Math.max(0, (this.counters.get(key) ?? 0) - 1);
    if (n === 0) this.counters.delete(key);
    else this.counters.set(key, n);
    return n;
  }
}

/** 空 ConfigService：所有 get 返回 undefined，阈值走内置默认 */
const noopConfig = { get: (_k: string, def?: string) => def } as never;
/** 空 PrismaService：sysConfig.findMany 返回空（走 env 默认阈值） */
const noopPrisma = { sysConfig: { findMany: async () => [] } } as never;

function makeService(store: RateLimitStore): RateLimitService {
  return new RateLimitService(store, noopConfig, noopPrisma);
}

/** 构造带路由/客户端信息的最小 ExecutionContext */
function makeCtx(path: string, extra?: { ip?: string; user?: { userId?: string } }): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ route: { path }, path, ip: extra?.ip, user: extra?.user }),
    }),
  } as unknown as ExecutionContext;
}

describe('M7.2 令牌桶', () => {
  it('容量内放行，耗尽后拒绝，随时间补充恢复', async () => {
    const store = new MemoryRateLimitStore();
    const opts = { burst: 3, rate: 1 };
    expect(await store.takeToken('k', { ...opts, now: 1000 })).toBe(true);
    expect(await store.takeToken('k', { ...opts, now: 1000 })).toBe(true);
    expect(await store.takeToken('k', { ...opts, now: 1000 })).toBe(true);
    expect(await store.takeToken('k', { ...opts, now: 1000 })).toBe(false);
    // 1000ms 后按 rate=1 补 1 个令牌，恰好放行一次
    expect(await store.takeToken('k', { ...opts, now: 2000 })).toBe(true);
    expect(await store.takeToken('k', { ...opts, now: 2000 })).toBe(false);
  });

  it('并发计数 incr/decr 归零删键', async () => {
    const store = new MemoryRateLimitStore();
    expect(await store.incrWithTtl('sse', 3600)).toBe(1);
    expect(await store.incrWithTtl('sse', 3600)).toBe(2);
    expect(await store.decrToZero('sse')).toBe(1);
    expect(await store.decrToZero('sse')).toBe(0);
    expect(store.counters.has('sse')).toBe(false);
  });
});

describe('M7.2 RateLimitService', () => {
  it('checkAuth 桶耗尽抛 429 / 4004', async () => {
    const store = new MemoryRateLimitStore();
    // 默认 auth.burst=30：连打 30 次后第 31 次触发限流
    const svc = makeService(store);
    for (let i = 0; i < 30; i++) await svc.checkAuth('1.1.1.1');
    await expect(svc.checkAuth('1.1.1.1')).rejects.toMatchObject({ bizCode: ErrorCode.RATE_LIMITED });
  });

  it('checkGlobal 已登录按用户键、匿名按 IP 键', async () => {
    const store = new MemoryRateLimitStore();
    const svc = makeService(store);
    await svc.checkGlobal('user-1', '1.2.3.4');
    await svc.checkGlobal(null, '1.2.3.4');
    expect(store.tokenKeys).toEqual(['rl:global:user:user-1', 'rl:global:ip:1.2.3.4']);
  });

  it('SSE 并发槽位：超上限即拒绝并回退计数，释放恢复', async () => {
    const store = new MemoryRateLimitStore();
    const svc = makeService(store); // 默认 sseMaxConcurrent=3
    for (let i = 0; i < 3; i++) await svc.acquireSseSlot('u1');
    await expect(svc.acquireSseSlot('u1')).rejects.toMatchObject({ bizCode: ErrorCode.RATE_LIMITED });
    // 第 4 次被拒后应回退到 3（未越界残留）
    expect(store.counters.get('rl:sse:user:u1')).toBe(3);
    await svc.releaseSseSlot('u1');
    expect(store.counters.get('rl:sse:user:u1')).toBe(2);
  });
});

describe('M7.2 RateLimitGuard 路由组', () => {
  function makeGuard(service: Pick<RateLimitService, 'checkAuth' | 'checkGlobal'>) {
    return new RateLimitGuard(service as RateLimitService, noopConfig);
  }

  it('health/metrics 豁免', async () => {
    const calls: string[] = [];
    const guard = makeGuard({ checkAuth: async () => { calls.push('auth'); }, checkGlobal: async () => { calls.push('global'); } });
    expect(await guard.canActivate(makeCtx('/health'))).toBe(true);
    expect(await guard.canActivate(makeCtx('/metrics'))).toBe(true);
    expect(calls).toEqual([]);
  });

  it('/auth 走 IP 维度最严限流', async () => {
    const ips: string[] = [];
    const guard = makeGuard({ checkAuth: async (ip) => { ips.push(ip); }, checkGlobal: async () => {} });
    expect(await guard.canActivate(makeCtx('/auth/sms/send', { ip: '9.9.9.9' }))).toBe(true);
    expect(ips).toEqual(['9.9.9.9']);
  });

  it('/search/stream 跳过（SSE 并发由 controller 管理）', async () => {
    const calls: string[] = [];
    const guard = makeGuard({ checkAuth: async () => { calls.push('auth'); }, checkGlobal: async () => { calls.push('global'); } });
    expect(await guard.canActivate(makeCtx('/search/stream', { user: { userId: 'u1' } }))).toBe(true);
    expect(calls).toEqual([]);
  });

  it('普通接口已登录按用户、匿名按 IP', async () => {
    const keys: string[] = [];
    const guard = makeGuard({
      checkAuth: async () => {},
      checkGlobal: async (uid, ip) => { keys.push(`${uid ?? 'anon'}:${ip}`); },
    });
    await guard.canActivate(makeCtx('/workspace/datasets', { user: { userId: 'u1' }, ip: '5.5.5.5' }));
    await guard.canActivate(makeCtx('/search/histories', { ip: '5.5.5.5' }));
    expect(keys).toEqual(['u1:5.5.5.5', 'anon:5.5.5.5']);
  });

  it('RATE_LIMIT_ENABLED=false 整体关闭', async () => {
    const calls: string[] = [];
    const service = { checkAuth: async () => { calls.push('auth'); }, checkGlobal: async () => { calls.push('global'); } };
    const config = { get: (_k: string, def?: string) => (def === 'true' ? 'false' : def) } as never;
    const guard = new RateLimitGuard(service as RateLimitService, config);
    expect(await guard.canActivate(makeCtx('/auth/login'))).toBe(true);
    expect(calls).toEqual([]);
  });

  // 运行时 req.route.path 携带全局前缀 /api/v1（渗透自测发现的分组失配），剥离后分组必须一致
  it('带全局前缀的真实路由路径：auth 最严 / metrics 豁免 / SSE 跳过', async () => {
    const calls: string[] = [];
    const guard = makeGuard({
      checkAuth: async () => { calls.push('auth'); },
      checkGlobal: async () => { calls.push('global'); },
    });
    expect(await guard.canActivate(makeCtx('/api/v1/auth/login', { ip: '9.9.9.9' }))).toBe(true);
    expect(await guard.canActivate(makeCtx('/api/v1/auth/sms/send', { ip: '9.9.9.9' }))).toBe(true);
    expect(await guard.canActivate(makeCtx('/api/v1/metrics'))).toBe(true);
    expect(await guard.canActivate(makeCtx('/api/v1/health'))).toBe(true);
    expect(await guard.canActivate(makeCtx('/api/v1/search/stream'))).toBe(true);
    expect(calls).toEqual(['auth', 'auth']);
  });
});
