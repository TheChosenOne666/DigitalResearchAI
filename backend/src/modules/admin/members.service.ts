import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import { Prisma, OrderStatus } from '../../generated/prisma/client';
import { parsePageParams, buildPageResult } from './pagination';
import type { AdminPlanCreate, AdminPlanUpdate, AdminPlanEnabled, AdminBatchRenewal } from './dto';

/** 等级展示名 */
const LEVEL_TEXT: Record<string, string> = {
  FREE: '免费用户',
  PRO: '专业版',
  ENTERPRISE: '企业版',
};

/** 周期展示名 */
const CYCLE_TEXT: Record<string, string> = {
  SINGLE: '单月',
  MONTHLY: '连续包月',
  YEAR: '年付',
};

/** 会员套餐行（对外形状） */
export interface AdminPlanRow {
  id: string;
  code: string;
  level: string;
  levelName: string;
  cycle: string;
  cycleName: string;
  name: string;
  tag: string | null;
  badge: string | null;
  priceCents: number;
  originPriceCents: number | null;
  features: string[];
  sort: number;
  enabled: boolean;
}

/** 订单列表筛选条件 */
export interface AdminOrderListQuery {
  status?: string;
  keyword?: string;
  page: number;
  pageSize: number;
}

/** 套餐行转换 */
function toPlanRow(p: {
  id: string;
  code: string;
  level: string;
  cycle: string;
  name: string;
  tag: string | null;
  badge: string | null;
  priceCents: number;
  originPriceCents: number | null;
  features: unknown;
  sort: number;
  enabled: boolean;
}): AdminPlanRow {
  return {
    id: p.id,
    code: p.code,
    level: p.level,
    levelName: LEVEL_TEXT[p.level] ?? p.level,
    cycle: p.cycle,
    cycleName: CYCLE_TEXT[p.cycle] ?? p.cycle,
    name: p.name,
    tag: p.tag,
    badge: p.badge,
    priceCents: p.priceCents,
    originPriceCents: p.originPriceCents,
    features: Array.isArray(p.features) ? (p.features as string[]) : [],
    sort: p.sort,
    enabled: p.enabled,
  };
}

/** 订单套餐快照解析（下单时固化的 level/cycle/name/price） */
function readSnapshot(snapshot: unknown): { level: string; cycle: string; name: string; priceCents: number } {
  if (snapshot && typeof snapshot === 'object') {
    const s = snapshot as Record<string, unknown>;
    return {
      level: String(s.level ?? ''),
      cycle: String(s.cycle ?? ''),
      name: String(s.name ?? ''),
      priceCents: Number(s.priceCents ?? 0),
    };
  }
  return { level: '', cycle: '', name: '', priceCents: 0 };
}

/**
 * 组织用户 · 会员管理服务（A-03）。
 * 平台级跨租户：会员等级（member_plans）为公共数据，订单/订阅跨租户查询，注入 PrismaService 本体（D1）。
 */
@Injectable()
export class AdminMembersService {
  private readonly logger = new Logger(AdminMembersService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ===== 会员等级（套餐）CRUD =====

  /** 会员套餐列表（含停用，按等级 + 排序） */
  async listPlans(): Promise<AdminPlanRow[]> {
    const plans = await this.prisma.memberPlan.findMany({
      orderBy: [{ level: 'asc' }, { sort: 'asc' }],
    });
    return plans.map(toPlanRow);
  }

  /** 新增会员套餐（编码唯一） */
  async createPlan(input: AdminPlanCreate): Promise<AdminPlanRow> {
    const dup = await this.prisma.memberPlan.findUnique({ where: { code: input.code } });
    if (dup) {
      throw new BizException(ErrorCode.CONFLICT, '套餐编码已存在', HttpStatus.CONFLICT);
    }
    const plan = await this.prisma.memberPlan.create({
      data: {
        code: input.code,
        level: input.level,
        cycle: input.cycle,
        name: input.name,
        tag: input.tag ?? null,
        badge: input.badge ?? null,
        priceCents: input.priceCents,
        originPriceCents: input.originPriceCents ?? null,
        features: (input.features ?? []) as Prisma.InputJsonValue,
        sort: input.sort ?? 0,
      },
    });
    this.logger.log(`管理端新增会员套餐: code=${plan.code}`);
    return toPlanRow(plan);
  }

  /** 编辑会员套餐（编码不可改） */
  async updatePlan(id: string, input: AdminPlanUpdate): Promise<AdminPlanRow> {
    const plan = await this.prisma.memberPlan.findUnique({ where: { id } });
    if (!plan) {
      throw new BizException(ErrorCode.NOT_FOUND, '套餐不存在', HttpStatus.NOT_FOUND);
    }
    const data: Prisma.MemberPlanUpdateInput = {};
    if (input.level !== undefined) data.level = input.level;
    if (input.cycle !== undefined) data.cycle = input.cycle;
    if (input.name !== undefined) data.name = input.name;
    if (input.tag !== undefined) data.tag = input.tag;
    if (input.badge !== undefined) data.badge = input.badge;
    if (input.priceCents !== undefined) data.priceCents = input.priceCents;
    if (input.originPriceCents !== undefined) data.originPriceCents = input.originPriceCents;
    if (input.features !== undefined) data.features = input.features as Prisma.InputJsonValue;
    if (input.sort !== undefined) data.sort = input.sort;

    const updated = await this.prisma.memberPlan.update({ where: { id }, data });
    this.logger.log(`管理端编辑会员套餐: id=${id}`);
    return toPlanRow(updated);
  }

  /** 会员套餐上下架 */
  async setPlanEnabled(id: string, input: AdminPlanEnabled) {
    const plan = await this.prisma.memberPlan.findUnique({ where: { id } });
    if (!plan) {
      throw new BizException(ErrorCode.NOT_FOUND, '套餐不存在', HttpStatus.NOT_FOUND);
    }
    const updated = await this.prisma.memberPlan.update({
      where: { id },
      data: { enabled: input.enabled },
    });
    this.logger.log(`管理端${input.enabled ? '上架' : '下架'}会员套餐: id=${id}`);
    return { id: updated.id, enabled: updated.enabled };
  }

  // ===== 缴费订单（跨租户） =====

  /** 缴费订单列表（跨租户，状态/关键词筛选 + 分页） */
  async listOrders(query: AdminOrderListQuery) {
    const where: Prisma.MemberOrderWhereInput = {};
    if (query.status) {
      where.status = query.status as OrderStatus;
    }
    const kw = query.keyword?.trim();
    if (kw) {
      where.OR = [{ orderNo: { contains: kw } }];
    }

    const params = parsePageParams(String(query.page), String(query.pageSize));
    const [total, orders] = await Promise.all([
      this.prisma.memberOrder.count({ where }),
      this.prisma.memberOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
    ]);

    const userMap = await this.loadUserMap(orders.map((o) => o.userId));
    const list = orders.map((o) => {
      const snap = readSnapshot(o.planSnapshot);
      return {
        id: o.id,
        orderNo: o.orderNo,
        userId: o.userId,
        user: userMap.get(o.userId) ?? null,
        level: snap.level,
        levelName: LEVEL_TEXT[snap.level] ?? snap.level,
        cycleName: CYCLE_TEXT[snap.cycle] ?? snap.cycle,
        planName: snap.name,
        amountCents: o.amountCents,
        channel: o.channel,
        status: o.status,
        paidAt: o.paidAt,
        createdAt: o.createdAt,
      };
    });
    return buildPageResult(list, total, params);
  }

  // ===== 续费提醒 =====

  /** 7 天内到期会员（等级非 FREE）+ 提醒状态 */
  async listRenewals() {
    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const subs = await this.prisma.memberSubscription.findMany({
      where: { level: { not: 'FREE' }, expireAt: { gte: now, lte: in7Days } },
      orderBy: { expireAt: 'asc' },
    });

    const userMap = await this.loadUserMap(subs.map((s) => s.userId));
    // 每个用户最近一次续费提醒时间（用于判定「已提醒/待提醒」）
    const userIds = subs.map((s) => s.userId);
    const remindMap = new Map<string, Date>();
    if (userIds.length > 0) {
      const msgs = await this.prisma.message.findMany({
        where: { userId: { in: userIds }, type: 'RENEWAL' },
        orderBy: { createdAt: 'desc' },
      });
      for (const m of msgs) {
        if (!remindMap.has(m.userId)) remindMap.set(m.userId, m.createdAt);
      }
    }

    return subs.map((s) => {
      const daysLeft = Math.ceil((s.expireAt!.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      const remindedAt = remindMap.get(s.userId);
      return {
        userId: s.userId,
        user: userMap.get(s.userId) ?? null,
        level: s.level,
        levelName: LEVEL_TEXT[s.level] ?? s.level,
        cycleName: s.cycle ? CYCLE_TEXT[s.cycle] ?? s.cycle : null,
        expireAt: s.expireAt,
        daysLeft,
        reminded: Boolean(remindedAt),
        remindedAt: remindedAt ?? null,
      };
    });
  }

  /** 发送单条续费提醒（写站内信 RENEWAL） */
  async sendRenewal(userId: string) {
    const sub = await this.prisma.memberSubscription.findUnique({ where: { userId } });
    if (!sub || sub.level === 'FREE' || !sub.expireAt) {
      throw new BizException(ErrorCode.NOT_FOUND, '该用户无有效会员', HttpStatus.NOT_FOUND);
    }
    const levelName = LEVEL_TEXT[sub.level] ?? sub.level;
    const expireText = sub.expireAt.toISOString().slice(0, 10);
    const msg = await this.prisma.message.create({
      data: {
        userId,
        title: '会员即将到期',
        content: `您的${levelName}会员将于 ${expireText} 到期，请及时续费以免影响使用。`,
        type: 'RENEWAL',
      },
    });
    this.logger.log(`管理端发送续费提醒: userId=${userId}`);
    return { ok: true, messageId: msg.id };
  }

  /** 批量发送续费提醒（过滤无有效会员的用户） */
  async batchRenewal(input: AdminBatchRenewal) {
    const userIds = [...new Set(input.userIds)];
    const subs = await this.prisma.memberSubscription.findMany({
      where: { userId: { in: userIds }, level: { not: 'FREE' }, expireAt: { not: null } },
    });
    if (subs.length === 0) {
      return { sent: 0 };
    }
    await this.prisma.message.createMany({
      data: subs.map((s) => ({
        userId: s.userId,
        title: '会员即将到期',
        content: `您的${LEVEL_TEXT[s.level] ?? s.level}会员即将到期，请及时续费以免影响使用。`,
        type: 'RENEWAL',
      })),
    });
    this.logger.log(`管理端批量续费提醒: ${subs.length} 人`);
    return { sent: subs.length };
  }

  /** 批量加载用户展示信息（username/realName/phone/nickname） */
  private async loadUserMap(userIds: string[]): Promise<
    Map<string, { id: string; username: string | null; realName: string | null; phone: string; nickname: string }>
  > {
    const uniq = [...new Set(userIds.filter(Boolean))];
    if (uniq.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: uniq } },
      select: { id: true, username: true, realName: true, phone: true, nickname: true },
    });
    return new Map(users.map((u) => [u.id, u]));
  }
}
