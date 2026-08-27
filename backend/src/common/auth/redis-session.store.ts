import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { SessionStore } from './session.service';

/**
 * SessionStore 的 Redis 实现：sess:{sid} String + user:sids:{uid} Set，多实例共享。
 */
@Injectable()
export class RedisSessionStore implements SessionStore, OnModuleDestroy {
  private readonly redis: Redis;
  private readonly logger = new Logger(RedisSessionStore.name);

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL', 'redis://localhost:6380');
    this.redis = new Redis(url, { maxRetriesPerRequest: 2 });
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

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    return (await this.redis.expire(key, ttlSeconds)) === 1;
  }

  async sadd(key: string, member: string, ttlSeconds: number): Promise<void> {
    await this.redis.sadd(key, member);
    // 集合无成员级 TTL，每次写入刷新集合 TTL（取会话 TTL 与集合剩余 TTL 较大者即可，简化为直接刷新）
    await this.redis.expire(key, ttlSeconds);
  }

  async srem(key: string, member: string): Promise<void> {
    await this.redis.srem(key, member);
  }

  async smembers(key: string): Promise<string[]> {
    return this.redis.smembers(key);
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
