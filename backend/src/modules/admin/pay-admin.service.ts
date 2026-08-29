import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import { Prisma, OrderStatus, PayChannel } from '../../generated/prisma/client';
import { parsePageParams, buildPageResult } from './pagination';
import type { AdminPayRefund, AdminPayChannelUpdate, AdminPayChannelKey } from './dto';

/** 订单状态白名单（A-20 退款/关闭状态机） */
const CLOSABLE_STATUSES: OrderStatus[] = ['PENDING', 'FAILED'];

/** 渠道行（对外形状，密钥只回状态不回明文） */
export interface AdminPayChannelRow {
  id: string;
  channel: string;
  merchantId: string | null;
  notifyUrl: string | null;
  enabled: boolean;
  hasKey: boolean;
  keyUpdatedAt: Date | null;
}

/**
 * 支付中心 · 管理端服务（A-20）。
 * 跨租户订单查询（D1 系统 client）；退款走 PAID → REFUNDED 状态机并写 REFUND 负数流水；
 * 渠道密钥 AES-256-GCM 加密存储（SECRET_ENC_KEY，未配置回退 PAY_MOCK_SECRET 并告警），只写不读。
 */
@Injectable()
export class AdminPayService {
  private readonly logger = new Logger(AdminPayService.name);
  private readonly encKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const encSecret = config.get<string>('SECRET_ENC_KEY');
    if (encSecret) {
      this.encKey = createHash('sha256').update(encSecret).digest();
    } else {
      const fallback = config.get<string>('PAY_MOCK_SECRET', 'dev-mock-secret-change-me');
      this.logger.warn('SECRET_ENC_KEY 未配置，支付渠道密钥加密回退 PAY_MOCK_SECRET 同源密钥');
      this.encKey = createHash('sha256').update(fallback).digest();
    }
  }

  // ===== 订单管理 =====

  /** 订单列表（跨租户，状态/渠道/关键词筛选 + 分页） */
  async listOrders(query: { status?: string; channel?: string; keyword?: string; page: number; pageSize: number }) {
    const where: Prisma.MemberOrderWhereInput = {};
    if (query.status && (Object.values(OrderStatus) as string[]).includes(query.status)) {
      where.status = query.status as OrderStatus;
    }
    if (query.channel && (Object.values(PayChannel) as string[]).includes(query.channel)) {
      where.channel = query.channel as PayChannel;
    }
    const keyword = query.keyword?.trim();
    if (keyword) {
      const users = await this.prisma.user.findMany({
        where: {
          OR: [
            { nickname: { contains: keyword } },
            { realName: { contains: keyword } },
            { username: { contains: keyword } },
            { phone: { contains: keyword } },
          ],
        },
        select: { id: true },
      });
      where.OR = [{ orderNo: { contains: keyword } }, { userId: { in: users.map((u) => u.id) } }];
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
    const userIds = [...new Set(orders.map((o) => o.userId))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, nickname: true, realName: true, username: true, phone: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u.realName || u.nickname || u.username || u.phone]));
    const list = orders.map((o) => {
      const snap = readSnapshot(o.planSnapshot);
      return {
        id: o.id,
        orderNo: o.orderNo,
        tenantId: o.tenantId,
        userId: o.userId,
        user: userMap.get(o.userId) ?? null,
        planName: snap.name,
        cycleName: snap.cycle,
        amountCents: o.amountCents,
        channel: o.channel,
        status: o.status,
        isRenewal: o.isRenewal,
        paidAt: o.paidAt,
        expireAt: o.expireAt,
        createdAt: o.createdAt,
      };
    });
    return buildPageResult(list, total, params);
  }

  /** 退款：PAID → REFUNDED，写 REFUND 负数流水（幂等键 R:{orderNo}:{ts}）+ 站内信 + 审计 */
  async refund(orderNo: string, input: AdminPayRefund) {
    const order = await this.prisma.memberOrder.findUnique({ where: { orderNo } });
    if (!order) {
      throw new BizException(ErrorCode.NOT_FOUND, '订单不存在', HttpStatus.NOT_FOUND);
    }
    if (order.status !== OrderStatus.PAID) {
      throw new BizException(ErrorCode.CONFLICT, '仅已支付订单可退款', HttpStatus.CONFLICT);
    }
    const transactionNo = `R:${orderNo}:${Date.now()}`;
    const refunded = await this.prisma.$transaction(async (tx) => {
      // updateMany 条件更新防并发重复退款
      const updated = await tx.memberOrder.updateMany({
        where: { id: order.id, status: OrderStatus.PAID },
        data: { status: OrderStatus.REFUNDED },
      });
      if (updated.count !== 1) {
        throw new BizException(ErrorCode.CONFLICT, '订单状态已变化，请刷新后重试', HttpStatus.CONFLICT);
      }
      await tx.paymentRecord.create({
        data: {
          tenantId: order.tenantId,
          orderId: order.id,
          orderNo: order.orderNo,
          transactionNo,
          channel: order.channel,
          amountCents: -order.amountCents,
          status: 'REFUND',
          rawPayload: { reason: input.reason, type: 'ADMIN_REFUND' } as Prisma.InputJsonValue,
        },
      });
      await tx.message.create({
        data: {
          userId: order.userId,
          title: '订单已退款',
          content: `订单 ${order.orderNo} 已完成退款（金额 ¥${(order.amountCents / 100).toFixed(2)}），原因：${input.reason}`,
          type: 'SYSTEM',
        },
      });
      return tx.memberOrder.findUnique({ where: { id: order.id } });
    });
    this.logger.log(`管理端退款：orderNo=${orderNo} amountCents=-${order.amountCents} txn=${transactionNo}`);
    return { id: refunded!.id, orderNo: refunded!.orderNo, status: refunded!.status, transactionNo };
  }

  /** 关闭异常/超时订单（PENDING/FAILED → CLOSED） */
  async close(orderNo: string) {
    const order = await this.prisma.memberOrder.findUnique({ where: { orderNo } });
    if (!order) {
      throw new BizException(ErrorCode.NOT_FOUND, '订单不存在', HttpStatus.NOT_FOUND);
    }
    if (!CLOSABLE_STATUSES.includes(order.status)) {
      throw new BizException(ErrorCode.CONFLICT, '仅待支付/回调异常订单可关闭', HttpStatus.CONFLICT);
    }
    const updated = await this.prisma.memberOrder.update({
      where: { id: order.id },
      data: { status: OrderStatus.CLOSED },
    });
    this.logger.log(`管理端关闭订单：orderNo=${orderNo}`);
    return { id: updated.id, orderNo: updated.orderNo, status: updated.status };
  }

  // ===== 支付渠道配置 =====

  /** 渠道列表（密钥只回状态不回明文） */
  async listChannels(): Promise<AdminPayChannelRow[]> {
    const rows = await this.prisma.payChannelConfig.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map((r) => ({
      id: r.id,
      channel: r.channel,
      merchantId: r.merchantId,
      notifyUrl: r.notifyUrl,
      enabled: r.enabled,
      hasKey: Boolean(r.secretEnc),
      keyUpdatedAt: r.keyUpdatedAt,
    }));
  }

  /** 编辑渠道（商户号/回调地址/启停） */
  async updateChannel(id: string, input: AdminPayChannelUpdate) {
    const row = await this.prisma.payChannelConfig.findUnique({ where: { id } });
    if (!row) {
      throw new BizException(ErrorCode.NOT_FOUND, '渠道不存在', HttpStatus.NOT_FOUND);
    }
    const updated = await this.prisma.payChannelConfig.update({
      where: { id },
      data: {
        ...(input.merchantId !== undefined ? { merchantId: input.merchantId } : {}),
        ...(input.notifyUrl !== undefined ? { notifyUrl: input.notifyUrl } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      },
    });
    this.logger.log(`管理端编辑支付渠道：id=${id} channel=${updated.channel}`);
    return { id: updated.id, channel: updated.channel, enabled: updated.enabled };
  }

  /** 更新/轮换密钥：AES-256-GCM 加密存储，只写不读 */
  async updateChannelKey(id: string, input: AdminPayChannelKey) {
    const row = await this.prisma.payChannelConfig.findUnique({ where: { id } });
    if (!row) {
      throw new BizException(ErrorCode.NOT_FOUND, '渠道不存在', HttpStatus.NOT_FOUND);
    }
    const secretEnc = this.encryptSecret(input.secret);
    const updated = await this.prisma.payChannelConfig.update({
      where: { id },
      data: { secretEnc, keyUpdatedAt: new Date() },
    });
    this.logger.log(`管理端更新渠道密钥：id=${id} channel=${updated.channel}（密钥不落日志）`);
    return { id: updated.id, channel: updated.channel, hasKey: true, keyUpdatedAt: updated.keyUpdatedAt };
  }

  /** AES-256-GCM 加密，输出 Base64：iv.tag.ciphertext */
  private encryptSecret(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`;
  }
}

/** 读取套餐快照（金额/周期展示用） */
function readSnapshot(snapshot: unknown): { name: string; cycle: string } {
  if (snapshot && typeof snapshot === 'object') {
    const s = snapshot as Record<string, unknown>;
    return {
      name: typeof s.name === 'string' ? s.name : '会员套餐',
      cycle: typeof s.cycleName === 'string' ? s.cycleName : typeof s.cycle === 'string' ? s.cycle : '',
    };
  }
  return { name: '会员套餐', cycle: '' };
}
