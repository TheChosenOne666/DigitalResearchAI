import { Injectable, Logger } from '@nestjs/common';
import { getTenantContext } from '../../common/auth/tenant-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { parsePageParams, buildPageResult } from './pagination';

/** 管理端操作审计入参 */
export interface AdminAuditInput {
  /** 动作（默认 ADMIN_OP；登录/导出/删除沿用既有 LOGIN / EXPORT / DELETE） */
  action?: string;
  /** 目标资源类型 */
  targetType?: string;
  /** 目标资源 ID */
  targetId?: string;
  /** 详情快照（JSON） */
  detail?: unknown;
  /** 来源 IP（由控制器从 request 传入） */
  ip?: string;
}

/** 审计查询页签（A-13：登录 / 导出 / 删除日志） */
export type AdminAuditTab = 'login' | 'export' | 'delete';

/** 页签 → 审计动作映射 */
const TAB_ACTIONS: Record<AdminAuditTab, string> = {
  login: 'LOGIN',
  export: 'EXPORT',
  delete: 'DELETE',
};

/**
 * 管理端审计服务（M6）：所有管理写操作统一落 `audit_logs`。
 * 使用系统 client（PrismaService 本体）写入，租户 ID 取自当前请求上下文；
 * 审计失败只记录日志，不阻断主流程（对齐 M1 登录审计的降级策略）。
 */
@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 记录一条管理端操作审计。
   * @param input 审计内容（动作/目标/详情/IP）
   */
  async record(input: AdminAuditInput): Promise<void> {
    const ctx = getTenantContext();
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: ctx?.tenantId ?? null,
          userId: ctx?.userId ?? null,
          action: input.action ?? 'ADMIN_OP',
          targetType: input.targetType ?? null,
          targetId: input.targetId ?? null,
          detail: (input.detail ?? undefined) as object | undefined,
          ip: input.ip ?? null,
        },
      });
    } catch (e) {
      this.logger.error(`管理端审计写入失败：${(e as Error).message}`);
    }
  }

  /**
   * 审计查询（A-13，只读）：按页签动作 + 时间窗口 + 关键词（用户/IP）+ 结果筛选，分页返回。
   * 日志只读不可修改；结果口径：detail.success === false 视为失败，其余视为成功。
   */
  async query(options: {
    tab: string;
    keyword?: string;
    result?: string;
    days?: number;
    page: number;
    pageSize: number;
  }) {
    const tab = (Object.keys(TAB_ACTIONS) as AdminAuditTab[]).includes(options.tab as AdminAuditTab)
      ? (options.tab as AdminAuditTab)
      : 'login';
    const where: Prisma.AuditLogWhereInput = { action: TAB_ACTIONS[tab] };
    const days = options.days && options.days > 0 ? options.days : 7;
    where.createdAt = { gte: new Date(Date.now() - days * 24 * 3600 * 1000) };
    const keyword = options.keyword?.trim();
    if (keyword) {
      where.OR = [
        { ip: { contains: keyword } },
        {
          user: {
            is: {
              OR: [
                { username: { contains: keyword } },
                { realName: { contains: keyword } },
                { nickname: { contains: keyword } },
                { phone: { contains: keyword } },
              ],
            },
          },
        },
      ];
    }
    if (options.result === 'fail') {
      where.detail = { path: ['success'], equals: false };
    } else if (options.result === 'success') {
      where.NOT = { detail: { path: ['success'], equals: false } };
    }
    const params = parsePageParams(String(options.page), String(options.pageSize));
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
        include: { user: { select: { id: true, username: true, realName: true, nickname: true, phone: true } } },
      }),
    ]);
    return buildPageResult(
      rows.map((r) => ({
        id: r.id,
        action: r.action,
        userId: r.userId,
        user: r.user ? (r.user.username ?? r.user.realName ?? r.user.nickname ?? r.user.phone) : null,
        ip: r.ip,
        detail: r.detail,
        success: (r.detail as { success?: boolean } | null)?.success !== false,
        createdAt: r.createdAt,
      })),
      total,
      params,
    );
  }
}
