import { Controller, Get, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { HealthData } from '@app/shared';

/** 各依赖服务连通性检查的超时时间（毫秒） */
const CHECK_TIMEOUT_MS = 2000;

/** 依赖服务默认地址（与 docker-compose.yml 一致），未配置 .env 时兜底 */
const DEFAULTS = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/ai_research',
  REDIS_URL: 'redis://localhost:6379',
  QDRANT_URL: 'http://localhost:6333',
} as const;

/**
 * 健康检查服务：探测 PostgreSQL / Redis / Qdrant 连通性。
 * 单项失败不阻断接口，整体降级为 degraded。
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly config: ConfigService) {}

  /** 读取配置项，未配置时返回默认值 */
  private get(key: keyof typeof DEFAULTS): string {
    return this.config.get<string>(key) ?? DEFAULTS[key];
  }

  /** 执行健康检查，verbose=true 时附带依赖服务状态 */
  async check(verbose: boolean): Promise<HealthData> {
    const checks = verbose
      ? {
          postgres: (await this.probePostgres()) ? ('up' as const) : ('down' as const),
          redis: (await this.probeRedis()) ? ('up' as const) : ('down' as const),
          qdrant: (await this.probeQdrant()) ? ('up' as const) : ('down' as const),
        }
      : undefined;

    const status = checks && Object.values(checks).some((v) => v === 'down') ? 'degraded' : 'ok';
    return {
      status,
      uptime: Math.round(process.uptime()),
      version: '0.1.0',
      ...(checks ? { checks } : {}),
    };
  }

  /** 探测 PostgreSQL：SELECT 1 */
  private async probePostgres(): Promise<boolean> {
    const connectionString = this.get('DATABASE_URL');
    const pool = new Pool({ connectionString, connectionTimeoutMillis: CHECK_TIMEOUT_MS, max: 1 });
    try {
      await pool.query('SELECT 1');
      return true;
    } catch (err) {
      this.logger.warn(`PostgreSQL 健康检查失败: ${(err as Error).message}`);
      return false;
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  /** 探测 Redis：PING */
  private async probeRedis(): Promise<boolean> {
    const url = this.get('REDIS_URL');
    const client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: CHECK_TIMEOUT_MS,
    });
    try {
      await client.connect();
      const pong = await client.ping();
      return pong === 'PONG';
    } catch (err) {
      this.logger.warn(`Redis 健康检查失败: ${(err as Error).message}`);
      return false;
    } finally {
      client.disconnect();
    }
  }

  /** 探测 Qdrant：GET /readyz */
  private async probeQdrant(): Promise<boolean> {
    const url = this.get('QDRANT_URL');
    try {
      const res = await fetch(`${url}/readyz`, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
      return res.ok;
    } catch (err) {
      this.logger.warn(`Qdrant 健康检查失败: ${(err as Error).message}`);
      return false;
    }
  }
}
