import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { getTenantContext } from '../../common/auth/tenant-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import { Prisma, ImportStatus } from '../../generated/prisma/client';
import { parsePageParams, buildPageResult } from './pagination';
import type { AdminImportReject } from './dto';

/** 审核队列筛选条件 */
export interface AdminImportQuery {
  status?: string;
  type?: string;
  page: number;
  pageSize: number;
}

/** 审核队列行（含提交人、超期标记） */
export interface AdminImportRow {
  id: string;
  name: string;
  type: string;
  sizeBytes: number | null;
  submitterId: string;
  submitter: string | null;
  status: string;
  rejectReason: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
  /** 是否超过 3 个工作日未处理 */
  overdue: boolean;
}

/** 数据预览（前 5 行，含表头） */
type ImportPreview = { headers?: string[]; rows?: unknown[][] } | null | undefined;

/** 从预览中提取字段数（表头数量），无法识别时回退 0 */
function extractFieldCount(preview: ImportPreview): number {
  const headers = (preview as { headers?: unknown[] } | null | undefined)?.headers;
  return Array.isArray(headers) ? headers.length : 0;
}

/** 计算两个时间点之间的工作日数（含起始日，周末不计） */
export function countWorkdays(from: Date, to: Date): number {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  let workdays = 0;
  for (let t = start; t <= end; t += 24 * 3600 * 1000) {
    const d = new Date(t);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) workdays += 1;
  }
  return workdays;
}

/** 是否超过 3 个工作日未处理（A-08 高亮规则） */
export function isOverdue(createdAt: Date, now: Date): boolean {
  return countWorkdays(createdAt, now) > 3;
}

/**
 * 数据治理 · 数据接入审核服务（A-08）。
 * 通过 → 写入 datasets（source=IMPORT）+ 通知提交人；退回 → 原因必填 + 通知提交人。
 */
@Injectable()
export class AdminImportsService {
  private readonly logger = new Logger(AdminImportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 审核队列（状态/类型筛选 + 分页，超 3 工作日高亮） */
  async list(query: AdminImportQuery) {
    const where: Prisma.ImportTaskWhereInput = {};
    if (query.status === 'PENDING' || query.status === 'APPROVED' || query.status === 'REJECTED') {
      where.status = query.status;
    }
    if (query.type === 'EXCEL' || query.type === 'CSV' || query.type === 'DATABASE' || query.type === 'API') {
      where.type = query.type;
    }

    const params = parsePageParams(String(query.page), String(query.pageSize));
    const [total, rows] = await Promise.all([
      this.prisma.importTask.count({ where }),
      this.prisma.importTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
    ]);
    // 手动批量组装提交人展示名（submitterId 无 FK relation，跨租户直查）
    const submitterIds = [...new Set(rows.map((r) => r.submitterId))];
    const submitters = await this.prisma.user.findMany({
      where: { id: { in: submitterIds } },
      select: { id: true, username: true, nickname: true, phone: true },
    });
    const submitterMap = new Map(submitters.map((u) => [u.id, u.username ?? u.nickname ?? u.phone]));
    const now = new Date();
    return buildPageResult(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        sizeBytes: r.sizeBytes,
        submitterId: r.submitterId,
        submitter: submitterMap.get(r.submitterId) ?? null,
        status: r.status,
        rejectReason: r.rejectReason,
        createdAt: r.createdAt,
        reviewedAt: r.reviewedAt,
        overdue: r.status === 'PENDING' && isOverdue(r.createdAt, now),
      })),
      total,
      params,
    );
  }

  /** 审核通过：写入 datasets + 状态 APPROVED + 通知提交人 */
  async approve(id: string) {
    const task = await this.prisma.importTask.findUnique({ where: { id } });
    if (!task) {
      throw new BizException(ErrorCode.NOT_FOUND, '导入任务不存在', HttpStatus.NOT_FOUND);
    }
    if (task.status !== 'PENDING') {
      throw new BizException(ErrorCode.CONFLICT, '该任务已处理，不能重复审核', HttpStatus.CONFLICT);
    }
    const operatorId = this.operatorId();

    await this.prisma.$transaction(async (tx) => {
      await tx.importTask.update({
        where: { id },
        data: { status: ImportStatus.APPROVED, reviewedBy: operatorId, reviewedAt: new Date() },
      });
      await tx.dataset.create({
        data: {
          tenantId: task.tenantId,
          name: task.name,
          source: 'IMPORT',
          category: null,
          fieldCount: extractFieldCount(task.preview as ImportPreview),
          status: 'ONLINE',
        },
      });
      await tx.message.create({
        data: {
          userId: task.submitterId,
          title: '数据接入审核通过',
          content: `您提交的数据「${task.name}」已通过审核并入库。`,
          type: 'IMPORT',
        },
      });
    });
    this.logger.log(`管理端审核通过导入任务: id=${id}`);
    return { id, status: 'APPROVED' };
  }

  /** 审核退回：原因必填 + 状态 REJECTED + 通知提交人 */
  async reject(id: string, input: AdminImportReject) {
    const task = await this.prisma.importTask.findUnique({ where: { id } });
    if (!task) {
      throw new BizException(ErrorCode.NOT_FOUND, '导入任务不存在', HttpStatus.NOT_FOUND);
    }
    if (task.status !== 'PENDING') {
      throw new BizException(ErrorCode.CONFLICT, '该任务已处理，不能重复审核', HttpStatus.CONFLICT);
    }
    const operatorId = this.operatorId();

    await this.prisma.$transaction(async (tx) => {
      await tx.importTask.update({
        where: { id },
        data: {
          status: ImportStatus.REJECTED,
          rejectReason: input.reason,
          reviewedBy: operatorId,
          reviewedAt: new Date(),
        },
      });
      await tx.message.create({
        data: {
          userId: task.submitterId,
          title: '数据接入审核退回',
          content: `您提交的数据「${task.name}」被退回，原因：${input.reason}`,
          type: 'IMPORT',
        },
      });
    });
    this.logger.log(`管理端审核退回导入任务: id=${id}`);
    return { id, status: 'REJECTED' };
  }

  /** 数据预览（前 5 行） */
  async preview(id: string) {
    const task = await this.prisma.importTask.findUnique({ where: { id } });
    if (!task) {
      throw new BizException(ErrorCode.NOT_FOUND, '导入任务不存在', HttpStatus.NOT_FOUND);
    }
    return { id: task.id, name: task.name, type: task.type, preview: task.preview };
  }

  /** 当前操作用户 ID */
  private operatorId(): string {
    const ctx = getTenantContext();
    if (!ctx) {
      throw new BizException(ErrorCode.UNAUTHORIZED, '未登录', HttpStatus.UNAUTHORIZED);
    }
    return ctx.userId;
  }
}
