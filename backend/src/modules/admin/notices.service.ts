import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { getTenantContext } from '../../common/auth/tenant-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import { Prisma } from '../../generated/prisma/client';
import { parsePageParams, buildPageResult } from './pagination';
import type { AdminNoticeCreate, AdminNoticeUpdate } from './dto';

/** 公告列表筛选条件 */
export interface AdminNoticeQuery {
  status?: string;
  page: number;
  pageSize: number;
}

/**
 * 运营管理 · 消息公告服务（A-09）。
 * 公告生命周期：DRAFT → PUBLISHED → WITHDRAWN；仅平台管理员可操作。
 */
@Injectable()
export class AdminNoticesService {
  private readonly logger = new Logger(AdminNoticesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 公告列表（状态筛选 + 分页，最新在前） */
  async list(query: AdminNoticeQuery) {
    const where: Prisma.NoticeWhereInput = {};
    if (query.status === 'DRAFT' || query.status === 'PUBLISHED' || query.status === 'WITHDRAWN') {
      where.status = query.status;
    }
    const params = parsePageParams(String(query.page), String(query.pageSize));
    const [total, rows] = await Promise.all([
      this.prisma.notice.count({ where }),
      this.prisma.notice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
    ]);
    return buildPageResult(rows, total, params);
  }

  /** 新建公告（默认草稿） */
  async create(input: AdminNoticeCreate) {
    const row = await this.prisma.notice.create({
      data: {
        title: input.title,
        content: input.content,
        scope: input.scope,
        scopeValue: input.scopeValue ?? null,
        createdBy: this.operatorIdOrNull(),
      },
    });
    this.logger.log(`管理端新建公告: id=${row.id}`);
    return row;
  }

  /** 编辑公告（仅草稿/已撤回可编辑，避免改动已发布内容） */
  async update(id: string, input: AdminNoticeUpdate) {
    const existing = await this.prisma.notice.findUnique({ where: { id } });
    if (!existing) {
      throw new BizException(ErrorCode.NOT_FOUND, '公告不存在', HttpStatus.NOT_FOUND);
    }
    if (existing.status === 'PUBLISHED') {
      throw new BizException(ErrorCode.CONFLICT, '已发布公告不可编辑，请先撤回', HttpStatus.CONFLICT);
    }
    const row = await this.prisma.notice.update({
      where: { id },
      data: {
        ...(input.title ? { title: input.title } : {}),
        ...(input.content ? { content: input.content } : {}),
        ...(input.scope ? { scope: input.scope } : {}),
        ...(input.scopeValue !== undefined ? { scopeValue: input.scopeValue ?? null } : {}),
      },
    });
    this.logger.log(`管理端编辑公告: id=${id}`);
    return row;
  }

  /** 发布公告 */
  async publish(id: string) {
    const existing = await this.prisma.notice.findUnique({ where: { id } });
    if (!existing) {
      throw new BizException(ErrorCode.NOT_FOUND, '公告不存在', HttpStatus.NOT_FOUND);
    }
    if (existing.status === 'PUBLISHED') {
      throw new BizException(ErrorCode.CONFLICT, '公告已发布', HttpStatus.CONFLICT);
    }
    const row = await this.prisma.notice.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
    this.logger.log(`管理端发布公告: id=${id}`);
    return { id: row.id, status: row.status };
  }

  /** 撤回公告 */
  async withdraw(id: string) {
    const existing = await this.prisma.notice.findUnique({ where: { id } });
    if (!existing) {
      throw new BizException(ErrorCode.NOT_FOUND, '公告不存在', HttpStatus.NOT_FOUND);
    }
    if (existing.status !== 'PUBLISHED') {
      throw new BizException(ErrorCode.CONFLICT, '仅已发布公告可撤回', HttpStatus.CONFLICT);
    }
    const row = await this.prisma.notice.update({
      where: { id },
      data: { status: 'WITHDRAWN' },
    });
    this.logger.log(`管理端撤回公告: id=${id}`);
    return { id: row.id, status: row.status };
  }

  /** 当前操作用户 ID（可为空） */
  private operatorIdOrNull(): string | null {
    const ctx = getTenantContext();
    return ctx?.userId ?? null;
  }
}
