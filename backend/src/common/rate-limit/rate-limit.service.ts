import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '@app/shared';
import { BizException } from '../exceptions/biz.exception';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitStore } from './rate-limit.store';

/** 单个令牌桶阈值 */
export interface BucketThreshold {
  /** 补充速率（令牌/秒） */
  rate: number;
  /** 桶容量（最大突发令牌数） */
  burst: number;
}

/** 三组限流阈值快照 */
export interface RateThresholds {
  /** 登录/验证码（IP 维度，最严） */
  auth: BucketThreshold;
  /** 普通读写接口（用户/匿名 IP 维度，宽松） */
  global: BucketThreshold;
  /** SSE 长连接并发上限（按用户） */
  sseMaxConcurrent: number;
}

/** 阈值内存缓存 TTL（毫秒）：sys_configs 修改后最多 30s 生效 */
const CACHE_TTL_MS = 30_000;

/** SSE 并发计数键 TTL（秒）：活跃期间每次 acquire 刷新 */
const SSE_SLOT_TTL_SECONDS = 3600;

/** 环境变量兜底默认阈值（sys_configs 未配置/DB 不可用时生效） */
const DEFAULT_THRESHOLDS: RateThresholds = {
  auth: { rate: 0.5, burst: 30 },
  global: { rate: 5, burst: 300 },
  sseMaxConcurrent: 3,
};

/** sys_configs 键清单（与 seed-admin 种子一致） */
const RATE_CONFIG_KEYS = [
  'rate.authRate',
  'rate.authBurst',
  'rate.globalRate',
  'rate.globalBurst',
  'rate.sseMaxConcurrent',
] as const;

/**
 * 限流服务（M7.2）：令牌桶速率限流 + SSE 并发槽位。
 * 阈值解析优先级：sys_configs（30s 缓存，DB 不可用回退）> 环境变量 > 内置默认。
 * 全部阈值在内存缓存，检查本身仅一次 Redis Lua，不在请求路径上查库。
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private cache: { values: RateThresholds; at: number } | null = null;

  constructor(
    private readonly store: RateLimitStore,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /** 登录/验证码组：IP 维度令牌桶 */
  async checkAuth(ip: string): Promise<void> {
    const { auth } = await this.getThresholds();
    const allowed = await this.store.takeToken(`rl:auth:ip:${ip}`, { burst: auth.burst, rate: auth.rate });
    if (!allowed) throw this.limited('登录/验证码请求过于频繁，请稍后再试');
  }

  /** 普通读写组：已登录按用户、匿名按 IP 的令牌桶 */
  async checkGlobal(userId: string | null, ip: string): Promise<void> {
    const { global } = await this.getThresholds();
    const key = userId ? `rl:global:user:${userId}` : `rl:global:ip:${ip}`;
    const allowed = await this.store.takeToken(key, { burst: global.burst, rate: global.rate });
    if (!allowed) throw this.limited('请求过于频繁，请稍后再试');
  }

  /** SSE 并发槽位：占用一个连接，超上限立即释放并拒绝 */
  async acquireSseSlot(userId: string): Promise<void> {
    const { sseMaxConcurrent } = await this.getThresholds();
    const count = await this.store.incrWithTtl(`rl:sse:user:${userId}`, SSE_SLOT_TTL_SECONDS);
    if (count > sseMaxConcurrent) {
      await this.store.decrToZero(`rl:sse:user:${userId}`);
      throw this.limited('同时进行的检索任务过多，请稍后再试');
    }
  }

  /** SSE 并发槽位：释放一个连接（幂等，归零删键） */
  async releaseSseSlot(userId: string): Promise<void> {
    await this.store.decrToZero(`rl:sse:user:${userId}`);
  }

  private limited(message: string): BizException {
    return new BizException(ErrorCode.RATE_LIMITED, message, HttpStatus.TOO_MANY_REQUESTS);
  }

  /** 读取阈值快照（30s 缓存，避免每请求查库） */
  private async getThresholds(): Promise<RateThresholds> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < CACHE_TTL_MS) {
      return this.cache.values;
    }
    const values = await this.loadThresholds();
    this.cache = { values, at: now };
    return values;
  }

  /** 组装阈值：env 兜底 → sys_configs 覆盖 → 收敛到合法区间 */
  private async loadThresholds(): Promise<RateThresholds> {
    const values: RateThresholds = {
      auth: {
        rate: this.num('RATE_AUTH_RATE', DEFAULT_THRESHOLDS.auth.rate),
        burst: this.int('RATE_AUTH_BURST', DEFAULT_THRESHOLDS.auth.burst),
      },
      global: {
        rate: this.num('RATE_GLOBAL_RATE', DEFAULT_THRESHOLDS.global.rate),
        burst: this.int('RATE_GLOBAL_BURST', DEFAULT_THRESHOLDS.global.burst),
      },
      sseMaxConcurrent: this.int('RATE_SSE_MAX_CONCURRENT', DEFAULT_THRESHOLDS.sseMaxConcurrent),
    };

    try {
      const rows = await this.prisma.sysConfig.findMany({ where: { key: { in: [...RATE_CONFIG_KEYS] } } });
      const map = new Map(rows.map((r) => [r.key, r.value]));
      values.auth.rate = this.numOr(map.get('rate.authRate'), values.auth.rate);
      values.auth.burst = this.intOr(map.get('rate.authBurst'), values.auth.burst);
      values.global.rate = this.numOr(map.get('rate.globalRate'), values.global.rate);
      values.global.burst = this.intOr(map.get('rate.globalBurst'), values.global.burst);
      values.sseMaxConcurrent = this.intOr(map.get('rate.sseMaxConcurrent'), values.sseMaxConcurrent);
    } catch (err) {
      this.logger.warn(`sys_configs 读取失败，限流阈值回退环境变量: ${(err as Error).message}`);
    }

    // 收敛到合法区间，防御配置误填（rate 最小 0.01，burst 最小 1，SSE 并发最小 1）
    values.auth.rate = this.clampRate(values.auth.rate);
    values.auth.burst = Math.max(1, Math.floor(values.auth.burst));
    values.global.rate = this.clampRate(values.global.rate);
    values.global.burst = Math.max(1, Math.floor(values.global.burst));
    values.sseMaxConcurrent = Math.max(1, Math.floor(values.sseMaxConcurrent));
    return values;
  }

  private clampRate(rate: number): number {
    return Number.isFinite(rate) && rate > 0 ? Math.min(rate, 100000) : 0.01;
  }

  private num(key: string, def: number): number {
    const n = Number(this.config.get<string>(key));
    return Number.isFinite(n) ? n : def;
  }

  private int(key: string, def: number): number {
    const n = Number(this.config.get<string>(key));
    return Number.isFinite(n) ? Math.floor(n) : def;
  }

  private numOr(raw: string | undefined, def: number): number {
    if (raw == null || raw.trim() === '') return def;
    const n = Number(raw);
    return Number.isFinite(n) ? n : def;
  }

  private intOr(raw: string | undefined, def: number): number {
    if (raw == null || raw.trim() === '') return def;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.floor(n) : def;
  }
}
