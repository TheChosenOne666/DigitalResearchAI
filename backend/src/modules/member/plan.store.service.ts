import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import type { MemberLevel, PlanCycle } from '../../generated/prisma/client';
import { Prisma } from '../../generated/prisma/client';
import { MEMBER_PLAN_SEEDS } from './plans';

/** 套餐行（平台级公共数据） */
export interface PlanRow {
  id: string;
  code: string;
  level: MemberLevel;
  cycle: PlanCycle;
  name: string;
  tag: string | null;
  badge: string | null;
  priceCents: number;
  originPriceCents: number | null;
  features: unknown;
  sort: number;
}

/**
 * 会员套餐持久化（M5）：套餐为平台级数据（全租户共享，不走租户隔离），
 * 与租户级订阅/订单/流水（SubscriptionStore / OrderStore）按隔离语义分离。
 */
@Injectable()
export class PlanStoreService {
  private readonly logger = new Logger(PlanStoreService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 启动幂等初始化套餐种子：按 code upsert，补齐缺失项、不覆盖管理端改过的价格/上下架。
   * 返回 upsert 影响的条数（创建 + 更新）。
   */
  async ensureSeedPlans(): Promise<number> {
    let affected = 0;
    for (const seed of MEMBER_PLAN_SEEDS) {
      await this.prisma.memberPlan.upsert({
        where: { code: seed.code },
        create: {
          code: seed.code,
          level: seed.level,
          cycle: seed.cycle,
          name: seed.name,
          tag: seed.tag,
          badge: seed.badge,
          priceCents: seed.priceCents,
          originPriceCents: seed.originPriceCents,
          features: seed.features as unknown as Prisma.InputJsonValue,
          sort: seed.sort,
          enabled: true,
        },
        update: {},
      });
      affected += 1;
    }
    this.logger.log(`会员套餐种子已同步：${affected} 条`);
    return affected;
  }

  /** 上架套餐列表（按等级 + 排序） */
  async listPlans(): Promise<PlanRow[]> {
    const rows = await this.prisma.memberPlan.findMany({
      where: { enabled: true },
      orderBy: [{ sort: 'asc' }],
    });
    return rows.map(toPlanRow);
  }

  /** 按 id 取套餐（不存在 → 404） */
  async getPlan(id: string): Promise<PlanRow> {
    const r = await this.prisma.memberPlan.findFirst({ where: { id } });
    if (!r) {
      throw new BizException(ErrorCode.NOT_FOUND, '套餐不存在或已下架', HttpStatus.NOT_FOUND);
    }
    return toPlanRow(r);
  }

  /** 按等级 + 周期找上架套餐（自动续费生成续费单时使用） */
  async findPlan(level: MemberLevel, cycle: PlanCycle): Promise<PlanRow | null> {
    const r = await this.prisma.memberPlan.findFirst({ where: { level, cycle, enabled: true } });
    return r ? toPlanRow(r) : null;
  }
}

/** 套餐行转换（统一对外形状） */
function toPlanRow(r: {
  id: string;
  code: string;
  level: MemberLevel;
  cycle: PlanCycle;
  name: string;
  tag: string | null;
  badge: string | null;
  priceCents: number;
  originPriceCents: number | null;
  features: unknown;
  sort: number;
}): PlanRow {
  return {
    id: r.id,
    code: r.code,
    level: r.level,
    cycle: r.cycle,
    name: r.name,
    tag: r.tag,
    badge: r.badge,
    priceCents: r.priceCents,
    originPriceCents: r.originPriceCents,
    features: r.features,
    sort: r.sort,
  };
}
