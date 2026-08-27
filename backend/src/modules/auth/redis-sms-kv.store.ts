import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { SmsKvStore } from './sms-code.service';

/**
 * SmsKvStore 的 Redis 实现：验证码/冷却/限流计数全部走 Redis TTL 自动过期。
 */
@Injectable()
export class RedisSmsKvStore implements SmsKvStore, OnModuleDestroy {
  private readonly redis: Redis;
  private readonly logger = new Logger(RedisSmsKvStore.name);

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL', 'redis://localhost:6380');
    this.redis = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2 });
    this.redis.on('error', (err) => this.logger.error(`Redis 连接异常: ${err.message}`));
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  /** 自增并在键首次创建时设置 TTL（Redis 原子操作） */
  async incr(key: string, ttlSeconds: number): Promise<number> {
    const next = await this.redis.incr(key);
    if (next === 1) {
      await this.redis.expire(key, ttlSeconds);
    }
    return next;
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
