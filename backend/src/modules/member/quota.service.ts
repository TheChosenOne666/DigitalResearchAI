import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { HttpStatus } from '@nestjs/common';
import { BizException } from '../../common/exceptions/biz.exception';
import { RoleCode } from '../../common/auth/roles.decorator';
import { ErrorCode } from '@app/shared';
import { MemberStoreService } from './member.store.service';
import { FREE_TRIAL_LIMIT } from './plans';
import { isMemberEffective } from './subscription';

/** 消耗配额结果 */
export interface ConsumeResult {
  /** 是否放行 */
  allowed: true;
  /** 剩余免费次数（会员/管理员为 null 表示不限） */
  trialLeft: number | null;
}

/**
 * 免费体验配额服务（M5.3）：非会员终身 1 次智搜。
 * - Redis 原子 INCR 为准（并发安全），超限 DECR 回滚并抛 4003 引导开通
 * - DB `trial_quota` 持久化对账，Redis 不可用时降级读写 DB（不阻塞用户）
 * - 会员与管理端角色直接放行，不计数
 */
@Injectable()
export class QuotaService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly logger = new Logger(QuotaService.name);

  constructor(
    config: ConfigService,
    private readonly store: MemberStoreService,
  ) {
    const url = config.get<string>('REDIS_URL', 'redis://localhost:6380');
    this.redis = new Redis(url, { maxRetriesPerRequest: 2 });
    this.redis.on('error', (err) => this.logger.error(`Redis 连接异常: ${err.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }

  /** 免费体验计数键（终身有效，不设 TTL） */
  private key(userId: string): string {
    return `trial:used:${userId}`;
  }

  /** 是否会员（等级非 FREE 且未过期） */
  async isMember(userId: string): Promise<boolean> {
    const sub = await this.store.getSubscription(userId);
    return isMemberEffective(sub, new Date());
  }

  /**
   * 消耗一次免费体验配额（智搜入口调用）。
   * @throws BizException 4003 配额已用尽（前端据此弹开通会员引导）
   */
  async consumeTrial(userId: string, roles: string[]): Promise<ConsumeResult> {
    // 管理端角色与会员不做限制（对齐原型 vipCanSearch）
    if (roles?.includes(RoleCode.PLATFORM_ADMIN) || roles?.includes(RoleCode.DATA_ADMIN)) {
      return { allowed: true, trialLeft: null };
    }
    if (await this.isMember(userId)) {
      return { allowed: true, trialLeft: null };
    }

    const key = this.key(userId);
    try {
      const used = await this.redis.incr(key);
      if (used > FREE_TRIAL_LIMIT) {
        // 超限时回滚，避免重试请求把计数越推越高
        await this.redis.decr(key);
        throw new BizException(
          ErrorCode.QUOTA_EXCEEDED,
          '免费体验次数已用完，开通会员可无限次使用',
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
      // 持久化对账（幂等覆盖写，不累加）
      await this.store.setTrialUsed(userId, used);
      return { allowed: true, trialLeft: Math.max(0, FREE_TRIAL_LIMIT - used) };
    } catch (e) {
      if (e instanceof BizException) throw e;
      // Redis 不可用 → 降级 DB 计数，保证功能可用
      this.logger.warn(`Redis 配额计数失败，降级 DB: userId=${userId} ${(e as Error).message}`);
      const used = await this.store.getTrialUsed(userId);
      if (used >= FREE_TRIAL_LIMIT) {
        throw new BizException(
          ErrorCode.QUOTA_EXCEEDED,
          '免费体验次数已用完，开通会员可无限次使用',
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
      await this.store.setTrialUsed(userId, used + 1);
      return { allowed: true, trialLeft: Math.max(0, FREE_TRIAL_LIMIT - used - 1) };
    }
  }

  /** 查询剩余免费次数（不消耗）：会员/管理员返回 null 表示不限 */
  async trialLeft(userId: string, roles: string[] = []): Promise<number | null> {
    if (roles.includes(RoleCode.PLATFORM_ADMIN) || roles.includes(RoleCode.DATA_ADMIN)) return null;
    if (await this.isMember(userId)) return null;
    try {
      const raw = await this.redis.get(this.key(userId));
      const used = raw !== null ? Number(raw) : await this.store.getTrialUsed(userId);
      return Math.max(0, FREE_TRIAL_LIMIT - (Number.isFinite(used) ? used : 0));
    } catch (e) {
      this.logger.warn(`Redis 读取配额失败，降级 DB: userId=${userId} ${(e as Error).message}`);
      const used = await this.store.getTrialUsed(userId);
      return Math.max(0, FREE_TRIAL_LIMIT - used);
    }
  }
}
