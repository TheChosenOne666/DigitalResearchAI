import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { FusionResult } from '../src/modules/search/fusion/fusion.service';

/** Redis 故障开关（验证降级透传） */
const redisState = vi.hoisted(() => ({ down: false }));

/** 内存版 Redis（仅实现缓存用到的 GET/SET） */
const fakeRedis = vi.hoisted(() => ({ map: new Map<string, string>() }));

vi.mock('ioredis', () => ({
  default: class {
    on() {
      return this;
    }
    async get(key: string): Promise<string | null> {
      if (redisState.down) throw new Error('redis down');
      return fakeRedis.map.get(key) ?? null;
    }
    async set(key: string, value: string, _mode: string, _ttl: number): Promise<'OK'> {
      if (redisState.down) throw new Error('redis down');
      fakeRedis.map.set(key, value);
      return 'OK';
    }
    async quit(): Promise<void> {
      return undefined;
    }
  },
}));

const { SearchCacheService } = await import('../src/modules/search/search-cache.service');

/** 构造服务：Redis 走内存实现 */
function makeService() {
  const config = { get: (_k: string, d?: string) => d } as unknown as ConfigService;
  return new SearchCacheService(config);
}

const RESULT: FusionResult = {
  cited: [{ title: 'A', snippet: 's', sourceType: 'web', url: 'https://a' }],
  referenced: [{ title: 'B', snippet: 's', sourceType: 'local', url: 'kb://l/d/0' }],
  ranked: [],
};

describe('SearchCacheService 检索结果短缓存（检索优化 B）', () => {
  beforeEach(() => {
    fakeRedis.map.clear();
    redisState.down = false;
  });

  it('未命中返回 null；写入后命中返回原结果', async () => {
    const svc = makeService();
    expect(await svc.get('t1', 'hybrid', '问题', {})).toBeNull();
    await svc.set('t1', 'hybrid', '问题', {}, RESULT);
    const hit = await svc.get('t1', 'hybrid', '问题', {});
    expect(hit?.cited[0]?.title).toBe('A');
    expect(hit?.referenced[0]?.sourceType).toBe('local');
  });

  it('不同条件快照不串缓存（key 隔离）', async () => {
    const svc = makeService();
    await svc.set('t1', 'hybrid', '问题', {}, RESULT);
    const other = await svc.get('t1', 'hybrid', '问题', { countries: ['中国'] });
    expect(other).toBeNull();
  });

  it('不同租户/模式不串缓存', async () => {
    const svc = makeService();
    await svc.set('t1', 'hybrid', '问题', {}, RESULT);
    expect(await svc.get('t2', 'hybrid', '问题', {})).toBeNull();
    expect(await svc.get('t1', 'local', '问题', {})).toBeNull();
  });

  it('Redis 不可用：get 返回 null、set 不抛错（降级透传）', async () => {
    redisState.down = true;
    const svc = makeService();
    await expect(svc.get('t1', 'hybrid', '问题', {})).resolves.toBeNull();
    await expect(svc.set('t1', 'hybrid', '问题', {}, RESULT)).resolves.toBeUndefined();
  });

  it('脏缓存（结构不合法）静默丢弃返回 null', async () => {
    const svc = makeService();
    await svc.set('t1', 'hybrid', '问题', {}, RESULT);
    // 篡改为非法结构（模拟历史版本/损坏数据）
    const [key] = [...fakeRedis.map.keys()];
    fakeRedis.map.set(key, JSON.stringify({ cited: 'not-array' }));
    await expect(svc.get('t1', 'hybrid', '问题', {})).resolves.toBeNull();
  });
});
