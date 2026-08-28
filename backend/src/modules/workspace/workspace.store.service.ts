import { HttpStatus, Injectable } from '@nestjs/common';
import { getTenantContext } from '../../common/auth/tenant-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import { Prisma } from '../../generated/prisma/client';

/** 分析结果报告详情 */
export interface WorkspaceReportDetail {
  id: string;
  title: string;
  contentMd: string;
  paramsSnapshot: unknown;
  sources: unknown;
  tokenUsage: number;
  status: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** 报告落库输入 */
export interface WorkspaceReportInput {
  title: string;
  contentMd: string;
  paramsSnapshot: Record<string, unknown>;
  sources: unknown;
  tokenUsage: number;
}

/**
 * 工作台分析结果报告持久化（M4.3）：
 * 独立建表 workspace_reports（区别于智搜 SearchReport），经 forTenant 租户 Extension 行级隔离。
 */
@Injectable()
export class WorkspaceStoreService {
  constructor(private readonly prisma: PrismaService) {}

  /** 当前请求租户上下文（受保护路由由拦截器注入；缺失视为未授权） */
  private requireTenant(): { tenantId: string; userId: string } {
    const ctx = getTenantContext();
    if (!ctx) {
      throw new BizException(ErrorCode.UNAUTHORIZED, '缺少租户上下文', HttpStatus.UNAUTHORIZED);
    }
    return { tenantId: ctx.tenantId, userId: ctx.userId };
  }

  /** 落分析结果报告，返回报告 id */
  async saveReport(userId: string, input: WorkspaceReportInput): Promise<{ id: string }> {
    const { tenantId } = this.requireTenant();
    const report = await this.prisma.forTenant.workspaceReport.create({
      data: {
        tenantId,
        userId,
        title: input.title,
        contentMd: input.contentMd,
        paramsSnapshot: input.paramsSnapshot as Prisma.InputJsonValue,
        sources: input.sources as Prisma.InputJsonValue,
        tokenUsage: input.tokenUsage,
      },
    });
    return { id: report.id };
  }

  /** 报告详情（跨租户/不存在 → 404） */
  async reportDetail(id: string): Promise<WorkspaceReportDetail> {
    const report = await this.prisma.forTenant.workspaceReport.findFirst({ where: { id } });
    if (!report) {
      throw new BizException(ErrorCode.NOT_FOUND, '分析报告不存在', HttpStatus.NOT_FOUND);
    }
    return {
      id: report.id,
      title: report.title,
      contentMd: report.contentMd,
      paramsSnapshot: report.paramsSnapshot,
      sources: report.sources,
      tokenUsage: report.tokenUsage,
      status: report.status,
      version: report.version,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    };
  }
}
