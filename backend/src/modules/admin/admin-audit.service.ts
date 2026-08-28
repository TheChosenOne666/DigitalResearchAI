import { Injectable, Logger } from '@nestjs/common';
import { getTenantContext } from '../../common/auth/tenant-context';
import { PrismaService } from '../../common/prisma/prisma.service';

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
}
