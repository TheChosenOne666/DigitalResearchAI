import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { createHash } from 'node:crypto';
import type { FusionResult } from './fusion/fusion.service';
import type { SearchConditions } from './connectors/connector.interface';
import type { SearchMode } from './connectors/connector.interface';

/** 缓存 TTL（秒）：同问题重复检索窗口，平衡外部调用成本与知识库时效 */
const CACHE_TTL_SECONDS = 600;

/**
 * 智搜检索结果短缓存（检索优化 B）：
 * - key = tenantId + mode + question sha256 + conditions 快照 hash（租户/模式/条件隔离）
 * - 只缓存「检索融合结果」（FusionResult），报告生成照常流式执行（体验保留）
 * - Redis 不可用降级透传（不缓存也不报错，不阻塞主链路）；
 *   读到结构异常的缓存同样静默丢弃，回退真实检索
 */
@Injectable()
export class SearchCacheService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly logger = new Logger(SearchCacheService.name);

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL', 'redis://localhost:6380');
    this.redis = new Redis(url, { maxRetriesPerRequest: 2 });
    this.redis.on('error', (err) => this.logger.warn(`检索缓存 Redis 异常（降级透传）: ${err.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }

  /** 缓存键：问题与条件快照一并参与 hash，避免同问题不同条件串结果 */
  private key(
    tenantId: string,
    mode: SearchMode,
    question: string,
    conditions: SearchConditions,
  ): string {
    const condHash = createHash('sha256').update(JSON.stringify(conditions ?? {})).digest('hex').slice(0, 16);
    const qHash = createHash('sha256').update(question).digest('hex').slice(0, 16);
    return `search:cache:${tenantId}:${mode}:${qHash}:${condHash}`;
  }

  /** 读缓存：未命中/结构异常/Redis 不可用一律返回 null（调用方回退真实检索） */
  async get(
    tenantId: string,
    mode: SearchMode,
    question: string,
    conditions: SearchConditions,
  ): Promise<FusionResult | null> {
    try {
      const raw = await this.redis.get(this.key(tenantId, mode, question, conditions));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as FusionResult;
      // 最小结构校验：cited/referenced 均为数组才可用，防脏缓存进管道
      if (!Array.isArray(parsed?.cited) || !Array.isArray(parsed?.referenced)) {
        this.logger.warn('缓存结构异常，丢弃并回退真实检索');
        return null;
      }
      return parsed;
    } catch (e) {
      this.logger.warn(`读检索缓存失败（透传）: ${(e as Error).message}`);
      return null;
    }
  }

  /** 写缓存：失败仅告警（不影响主流程） */
  async set(
    tenantId: string,
    mode: SearchMode,
    question: string,
    conditions: SearchConditions,
    result: FusionResult,
  ): Promise<void> {
    try {
      await this.redis.set(
        this.key(tenantId, mode, question, conditions),
        JSON.stringify(result),
        'EX',
        CACHE_TTL_SECONDS,
      );
    } catch (e) {
      this.logger.warn(`写检索缓存失败（忽略）: ${(e as Error).message}`);
    }
  }
}
