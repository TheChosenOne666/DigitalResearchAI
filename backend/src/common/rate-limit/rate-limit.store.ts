import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/** 令牌桶取令牌入参 */
export interface TokenBucketOptions {
  /** 桶容量（最大突发令牌数） */
  burst: number;
  /** 补充速率（令牌/秒） */
  rate: number;
  /** 当前时间戳（毫秒），测试注入用；缺省 Date.now() */
  now?: number;
}

/**
 * 限流底层存储抽象（Redis 实现 + 测试内存实现）。
 *
 * 采用令牌桶模型：桶以固定速率补充令牌、容量上限为 burst；
 * 每请求消费 1 个令牌，令牌不足即拒绝（允许短时突发，长期收敛到 rate 的稳定速率）。
 * SSE 并发上限不属于速率维度，单独用计数器（incr/decr）管理。
 */
export abstract class RateLimitStore {
  /** 令牌桶原子取令牌（补桶 + 扣减一步完成），返回是否放行 */
  abstract takeToken(key: string, opts: TokenBucketOptions): Promise<boolean>;
  /** 并发计数自增并刷新 TTL，返回新值 */
  abstract incrWithTtl(key: string, ttlSeconds: number): Promise<number>;
  /** 并发计数自减（下限 0，归零删键），返回新值 */
  abstract decrToZero(key: string): Promise<number>;
}

/** 令牌桶 Lua：补桶 + 扣减 + 设置闲置 TTL 原子执行，避免多实例/并发下的竞态 */
const TOKEN_BUCKET_LUA = `
local burst = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local v = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(v[1])
local ts = tonumber(v[2])

if tokens == nil then
  tokens = burst
  ts = now
else
  local elapsed = (now - ts) / 1000
  if elapsed > 0 then
    tokens = math.min(burst, tokens + elapsed * rate)
    ts = now
  end
end

local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', tostring(ts))
-- 闲置桶 TTL：空桶补满所需时间 + 1s 缓冲，避免长期占内存
local ttl = math.max(1, math.ceil(burst / rate) + 1)
redis.call('EXPIRE', KEYS[1], ttl)

return allowed
`;

/** 并发计数自减 Lua：降到 0 即删键，避免残留 0 值键 */
const DECR_LUA = `
local v = redis.call('DECR', KEYS[1])
if v <= 0 then
  redis.call('DEL', KEYS[1])
  return 0
end
return v
`;

/**
 * RateLimitStore 的 Redis 实现：令牌桶走 Lua 原子执行，并发计数走 INCR/DECR。
 */
@Injectable()
export class RedisRateLimitStore extends RateLimitStore implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly logger = new Logger(RedisRateLimitStore.name);

  constructor(config: ConfigService) {
    super();
    const url = config.get<string>('REDIS_URL', 'redis://localhost:6380');
    this.redis = new Redis(url, { maxRetriesPerRequest: 2 });
    this.redis.on('error', (err) => this.logger.error(`Redis 连接异常: ${err.message}`));
  }

  async takeToken(key: string, opts: TokenBucketOptions): Promise<boolean> {
    const now = opts.now ?? Date.now();
    const allowed = await this.redis.eval(
      TOKEN_BUCKET_LUA,
      1,
      key,
      String(opts.burst),
      String(opts.rate),
      String(now),
      '1',
    );
    return Number(allowed) === 1;
  }

  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const next = await this.redis.incr(key);
    // 活跃期间每次自增刷新 TTL，保证长连接不会因键过期而丢失计数
    await this.redis.expire(key, ttlSeconds);
    return next;
  }

  async decrToZero(key: string): Promise<number> {
    return Number(await this.redis.eval(DECR_LUA, 1, key));
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
