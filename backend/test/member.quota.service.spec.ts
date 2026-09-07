import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';

/** Redis 故障开关（模拟 Redis 不可用，验证 DB 降级） */
const redisState = vi.hoisted(() => ({ down: false }));

/** 内存版 Redis（仅实现配额用到的 INCR/DECR/GET） */
const fakeRedis = vi.hoisted(() => {
  const map = new Map<string, number>();
  return { map };
});

vi.mock('ioredis', () => ({
  default: class {
    on() {
      return this;
    }
    async incr(key: string): Promise<number> {
      if (redisState.down) throw new Error('redis down');
      const next = (fakeRedis.map.get(key) ?? 0) + 1;
      fakeRedis.map.set(key, next);
      return next;
    }
    async decr(key: string): Promise<number> {
      if (redisState.down) throw new Error('redis down');
      const next = (fakeRedis.map.get(key) ?? 0) - 1;
      fakeRedis.map.set(key, next);
      return next;
    }
    async get(key: string): Promise<string | null> {
      if (redisState.down) throw new Error('redis down');
      const v = fakeRedis.map.get(key);
      return v === undefined ? null : String(v);
    }
    async set(key: string, value: string): Promise<void> {
      if (redisState.down) throw new Error('redis down');
      fakeRedis.map.set(key, Number(value));
    }
    async quit(): Promise<void> {
      return undefined;
    }
  },
}));

const { QuotaService } = await import('../src/modules/member/quota.service');
type QuotaServiceType = InstanceType<typeof QuotaService>;

/** 构造服务：订阅 store 用 mock，Redis 走内存实现 */
function makeService(opts?: { member?: boolean; dbUsed?: number }) {
  const store = {
    getSubscription: vi.fn().mockResolvedValue(
      opts?.member
        ? {
            id: 's1',
            userId: 'u1',
            level: 'PRO',
            cycle: 'MONTHLY',
            expireAt: new Date(Date.now() + 86_400_000),
            autoRenew: false,
            totalPeriods: 1,
          }
        : null,
    ),
    getTrialUsed: vi.fn().mockResolvedValue(opts?.dbUsed ?? 0),
    setTrialUsed: vi.fn().mockResolvedValue(undefined),
  };
  const config = { get: <T>(_k: string, def: T): T => def } as unknown as ConfigService;
  const svc = new QuotaService(config, store as never) as QuotaServiceType;
  return { svc, store };
}

beforeEach(() => {
  fakeRedis.map.clear();
  redisState.down = false;
});

describe('QuotaService.consumeTrial（免费体验 1 次）', () => {
  it('第 1 次使用放行，剩余 0 次', async () => {
    const { svc, store } = makeService();
    const res = await svc.consumeTrial('u1', ['USER']);
    expect(res).toEqual({ allowed: true, trialLeft: 0 });
    // 同步落 DB 对账
    expect(store.setTrialUsed).toHaveBeenCalledWith('u1', 1);
  });

  it('第 2 次使用被拦截（4003 配额用尽）', async () => {
    const { svc } = makeService();
    await svc.consumeTrial('u1', ['USER']);
    await expect(svc.consumeTrial('u1', ['USER'])).rejects.toMatchObject({ bizCode: 4003 });
  });

  it('拦截后 Redis 计数回滚（重试不会把计数越推越高）', async () => {
    const { svc } = makeService();
    await svc.consumeTrial('u1', ['USER']);
    await expect(svc.consumeTrial('u1', ['USER'])).rejects.toMatchObject({ bizCode: 4003 });
    await expect(svc.consumeTrial('u1', ['USER'])).rejects.toMatchObject({ bizCode: 4003 });
    expect(fakeRedis.map.get('trial:used:u1')).toBe(1);
  });

  it('会员直接放行且不计数', async () => {
    const { svc, store } = makeService({ member: true });
    const res = await svc.consumeTrial('u1', ['USER']);
    expect(res).toEqual({ allowed: true, trialLeft: null });
    expect(store.setTrialUsed).not.toHaveBeenCalled();
    expect(fakeRedis.map.size).toBe(0);
  });

  it('管理端角色直接放行且不计数', async () => {
    const { svc } = makeService();
    await expect(svc.consumeTrial('u1', ['PLATFORM_ADMIN'])).resolves.toEqual({
      allowed: true,
      trialLeft: null,
    });
    await expect(svc.consumeTrial('u2', ['DATA_ADMIN'])).resolves.toEqual({
      allowed: true,
      trialLeft: null,
    });
    expect(fakeRedis.map.size).toBe(0);
  });

  it('不同用户计数相互独立', async () => {
    const { svc } = makeService();
    await svc.consumeTrial('u1', ['USER']);
    await expect(svc.consumeTrial('u1', ['USER'])).rejects.toMatchObject({ bizCode: 4003 });
    await expect(svc.consumeTrial('u2', ['USER'])).resolves.toEqual({ allowed: true, trialLeft: 0 });
  });

  it('Redis 故障 → 降级 DB 计数并放行', async () => {
    redisState.down = true;
    const { svc, store } = makeService({ dbUsed: 0 });
    const res = await svc.consumeTrial('u1', ['USER']);
    expect(res).toEqual({ allowed: true, trialLeft: 0 });
    expect(store.setTrialUsed).toHaveBeenCalledWith('u1', 1);
  });

  it('Redis 故障 + DB 已用完 → 仍拦截', async () => {
    redisState.down = true;
    const { svc } = makeService({ dbUsed: 1 });
    await expect(svc.consumeTrial('u1', ['USER'])).rejects.toMatchObject({ bizCode: 4003 });
  });
});

describe('QuotaService.trialLeft（查询剩余，不消耗）', () => {
  it('未使用 → 1 次；已使用 → 0 次', async () => {
    const { svc } = makeService();
    expect(await svc.trialLeft('u1', ['USER'])).toBe(1);
    await svc.consumeTrial('u1', ['USER']);
    expect(await svc.trialLeft('u1', ['USER'])).toBe(0);
  });

  it('会员/管理员 → null（不限）', async () => {
    const { svc } = makeService({ member: true });
    expect(await svc.trialLeft('u1', ['USER'])).toBeNull();
    const plain = makeService();
    expect(await plain.svc.trialLeft('u1', ['PLATFORM_ADMIN'])).toBeNull();
  });

  it('Redis 故障 → 降级读 DB', async () => {
    redisState.down = true;
    const { svc } = makeService({ dbUsed: 1 });
    expect(await svc.trialLeft('u1', ['USER'])).toBe(0);
  });
});

describe('QuotaService.rollbackTrial（管道失败回滚，M8）', () => {
  it('非会员回滚一次：Redis DECR + DB 对账同步', async () => {
    const { svc, store } = makeService();
    await svc.consumeTrial('u1', ['USER']);
    expect(fakeRedis.map.get('trial:used:u1')).toBe(1);
    await svc.rollbackTrial('u1', ['USER']);
    expect(fakeRedis.map.get('trial:used:u1')).toBe(0);
    expect(store.setTrialUsed).toHaveBeenLastCalledWith('u1', 0);
    expect(await svc.trialLeft('u1', ['USER'])).toBe(1);
  });

  it('计数已为 0 时回滚钳 0 不出负数', async () => {
    const { svc, store } = makeService();
    await svc.rollbackTrial('u1', ['USER']);
    expect(fakeRedis.map.get('trial:used:u1')).toBe(0);
    expect(store.setTrialUsed).toHaveBeenLastCalledWith('u1', 0);
  });

  it('会员/管理端角色不回滚（本就未计数）', async () => {
    const member = makeService({ member: true });
    await member.svc.rollbackTrial('u1', ['USER']);
    const admin = makeService();
    await admin.svc.rollbackTrial('u1', ['PLATFORM_ADMIN']);
    expect(member.store.setTrialUsed).not.toHaveBeenCalled();
    expect(admin.store.setTrialUsed).not.toHaveBeenCalled();
  });

  it('Redis 故障 → 降级 DB 递减（下限钳 0）', async () => {
    const { svc, store } = makeService({ dbUsed: 1 });
    redisState.down = true;
    await svc.rollbackTrial('u1', ['USER']);
    expect(store.setTrialUsed).toHaveBeenLastCalledWith('u1', 0);
  });
});
