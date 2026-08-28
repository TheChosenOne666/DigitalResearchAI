import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import { Prisma } from '../../generated/prisma/client';
import { parsePageParams, buildPageResult } from './pagination';
import type { AdminDatasetUpdate, AdminDatasetStatus } from './dto';

/** 数据集列表筛选条件 */
export interface AdminDatasetQuery {
  keyword?: string;
  source?: string;
  status?: string;
  page: number;
  pageSize: number;
}

/**
 * 数据资源 · 数据集管理服务（A-07）。
 * 平台级跨租户：可查看/编辑平台公共（tenantId=null）与各组织数据集；上下架状态变更。
 */
@Injectable()
export class AdminDatasetsService {
  private readonly logger = new Logger(AdminDatasetsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 数据集列表（关键词/来源/状态筛选 + 分页） */
  async list(query: AdminDatasetQuery) {
    const where: Prisma.DatasetWhereInput = {};
    const kw = query.keyword?.trim();
    if (kw) {
      where.OR = [
        { name: { contains: kw, mode: 'insensitive' } },
        { category: { contains: kw, mode: 'insensitive' } },
      ];
    }
    if (query.source === 'IMPORT' || query.source === 'UPLOAD' || query.source === 'COLLECT') {
      where.source = query.source;
    }
    if (query.status === 'ONLINE' || query.status === 'OFFLINE') {
      where.status = query.status;
    }

    const params = parsePageParams(String(query.page), String(query.pageSize));
    const [total, rows] = await Promise.all([
      this.prisma.dataset.count({ where }),
      this.prisma.dataset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
    ]);
    return buildPageResult(rows, total, params);
  }

  /** 数据集详情 */
  async detail(id: string) {
    const row = await this.prisma.dataset.findUnique({ where: { id } });
    if (!row) {
      throw new BizException(ErrorCode.NOT_FOUND, '数据集不存在', HttpStatus.NOT_FOUND);
    }
    return row;
  }

  /** 编辑数据集元数据（名称/分类/meta） */
  async update(id: string, input: AdminDatasetUpdate) {
    const existing = await this.prisma.dataset.findUnique({ where: { id } });
    if (!existing) {
      throw new BizException(ErrorCode.NOT_FOUND, '数据集不存在', HttpStatus.NOT_FOUND);
    }
    const row = await this.prisma.dataset.update({
      where: { id },
      data: {
        name: input.name,
        category: input.category ?? null,
        ...(input.meta !== undefined ? { meta: input.meta as Prisma.InputJsonValue } : {}),
      },
    });
    this.logger.log(`管理端编辑数据集: id=${id}`);
    return row;
  }

  /** 数据集上下架 */
  async setStatus(id: string, input: AdminDatasetStatus) {
    const existing = await this.prisma.dataset.findUnique({ where: { id } });
    if (!existing) {
      throw new BizException(ErrorCode.NOT_FOUND, '数据集不存在', HttpStatus.NOT_FOUND);
    }
    const row = await this.prisma.dataset.update({
      where: { id },
      data: { status: input.status },
    });
    this.logger.log(`管理端${input.status === 'ONLINE' ? '上架' : '下架'}数据集: id=${id}`);
    return { id: row.id, status: row.status };
  }
}
