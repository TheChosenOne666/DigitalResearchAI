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

  // ===== M4.4 我的数据 =====

  /** 收藏快照落库 */
  async saveDataset(input: {
    name: string;
    data: Record<string, unknown>;
    tags: string[];
    sourceType: string;
  }): Promise<{ id: string }> {
    const { tenantId, userId } = this.requireTenant();
    const ds = await this.prisma.forTenant.workspaceDataset.create({
      data: {
        tenantId,
        userId,
        name: input.name,
        data: input.data as Prisma.InputJsonValue,
        tags: input.tags as Prisma.InputJsonValue,
        sourceType: input.sourceType,
      },
    });
    return { id: ds.id };
  }

  /** 我的数据列表（DB 过滤 status，内存过滤 keyword/tag + 分页） */
  async listDatasets(query: {
    keyword?: string;
    tag?: string;
    status?: string;
    page: number;
    pageSize: number;
  }): Promise<{ list: WorkspaceDatasetItem[]; total: number }> {
    const { userId } = this.requireTenant();
    const { keyword, tag, status, page, pageSize } = query;
    const rows = await this.prisma.forTenant.workspaceDataset.findMany({
      where: { userId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    const kw = keyword?.trim().toLowerCase();
    const filtered = rows.filter((d) => {
      const tags = (Array.isArray(d.tags) ? d.tags : []) as string[];
      if (kw && !d.name.toLowerCase().includes(kw) && !tags.some((t) => t.toLowerCase().includes(kw))) {
        return false;
      }
      if (tag && !tags.includes(tag)) return false;
      return true;
    });
    const total = filtered.length;
    const skip = Math.max(0, (page - 1) * pageSize);
    const list = filtered.slice(skip, skip + pageSize).map((d) => ({
      id: d.id,
      name: d.name,
      data: d.data,
      tags: (Array.isArray(d.tags) ? d.tags : []) as string[],
      status: d.status,
      sourceType: d.sourceType,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));
    return { list, total };
  }

  /** 归档/恢复（幂等 toggle），返回新状态 */
  async archiveDataset(id: string): Promise<{ status: string }> {
    const row = await this.prisma.forTenant.workspaceDataset.findFirst({ where: { id } });
    if (!row) {
      throw new BizException(ErrorCode.NOT_FOUND, '数据集不存在', HttpStatus.NOT_FOUND);
    }
    const next = row.status === 'ARCHIVED' ? 'ACTIVE' : 'ARCHIVED';
    await this.prisma.forTenant.workspaceDataset.update({ where: { id }, data: { status: next } });
    return { status: next };
  }

  /** 删除数据集（跨租户/不存在 → 404） */
  async deleteDataset(id: string): Promise<{ deleted: boolean }> {
    const row = await this.prisma.forTenant.workspaceDataset.findFirst({ where: { id } });
    if (!row) {
      throw new BizException(ErrorCode.NOT_FOUND, '数据集不存在', HttpStatus.NOT_FOUND);
    }
    await this.prisma.forTenant.workspaceDataset.delete({ where: { id } });
    return { deleted: true };
  }

  // ===== M4.4 我的报告（聚合）=====

  /** 聚合智搜报告（session 维度）与分析结果报告，按更新时间降序分页 */
  async listReports(query: {
    keyword?: string;
    page: number;
    pageSize: number;
  }): Promise<{ list: WorkspaceReportItem[]; total: number }> {
    const { userId } = this.requireTenant();
    const { keyword, page, pageSize } = query;
    const kw = keyword?.trim();

    // 智搜报告：session 含全部报告（版本数 = reports.length，最新报告时间为 updatedAt）
    const sessions = await this.prisma.forTenant.searchSession.findMany({
      where: { userId, ...(kw ? { question: { contains: kw } } : {}) },
      include: { reports: { orderBy: { createdAt: 'desc' } } },
    });
    const searchItems: WorkspaceReportItem[] = sessions
      .filter((s) => s.reports.length > 0)
      .map((s) => ({
        type: 'search',
        id: s.id,
        name: s.question || '智搜报告',
        format: '智搜报告',
        version: s.reports.length,
        updatedAt: s.reports[0].createdAt.toISOString(),
        status: 'READY',
      }));

    // 分析结果报告
    const reports = await this.prisma.forTenant.workspaceReport.findMany({
      where: { userId, ...(kw ? { title: { contains: kw } } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    const workspaceItems: WorkspaceReportItem[] = reports.map((r) => ({
      type: 'workspace',
      id: r.id,
      name: r.title,
      format: '分析报告',
      version: r.version,
      updatedAt: r.createdAt.toISOString(),
      status: r.status,
    }));

    const merged = [...searchItems, ...workspaceItems].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    const total = merged.length;
    const skip = Math.max(0, (page - 1) * pageSize);
    return { list: merged.slice(skip, skip + pageSize), total };
  }

  /** 报告版本列表（search：同 session 多次生成；workspace：当前报告单版本） */
  async listReportVersions(
    id: string,
    type: 'search' | 'workspace',
  ): Promise<{ list: Array<{ id: string; version: number; createdAt: Date; tokenUsage?: number }> }> {
    if (type === 'search') {
      const session = await this.prisma.forTenant.searchSession.findFirst({
        where: { id },
        include: { reports: { orderBy: { createdAt: 'asc' } } },
      });
      if (!session || !session.reports.length) {
        throw new BizException(ErrorCode.NOT_FOUND, '报告不存在', HttpStatus.NOT_FOUND);
      }
      return {
        list: session.reports.map((r, i) => ({
          id: r.id,
          version: i + 1,
          createdAt: r.createdAt,
          tokenUsage: r.tokenUsage,
        })),
      };
    }
    const report = await this.prisma.forTenant.workspaceReport.findFirst({ where: { id } });
    if (!report) {
      throw new BizException(ErrorCode.NOT_FOUND, '分析报告不存在', HttpStatus.NOT_FOUND);
    }
    return { list: [{ id: report.id, version: report.version, createdAt: report.createdAt }] };
  }
}

/** 我的数据列表项 */
export interface WorkspaceDatasetItem {
  id: string;
  name: string;
  data: unknown;
  tags: string[];
  status: string;
  sourceType: string;
  createdAt: Date;
  updatedAt: Date;
}

/** 我的报告聚合列表项 */
export interface WorkspaceReportItem {
  type: 'search' | 'workspace';
  id: string;
  name: string;
  format: string;
  version: number;
  updatedAt: string;
  status: string;
}
