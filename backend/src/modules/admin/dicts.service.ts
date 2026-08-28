import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import { Prisma, DictType } from '../../generated/prisma/client';
import { parsePageParams, buildPageResult } from './pagination';
import type { AdminDictCreate, AdminDictUpdate, AdminDictEnabled } from './dto';

/** 字典列表筛选条件 */
export interface AdminDictQuery {
  type: string;
  keyword?: string;
  enabled?: string;
  page: number;
  pageSize: number;
}

/**
 * 数据资源 · 字典管理服务（A-06）。
 * 平台级跨租户；字典项不提供删除（被引用时建议停用，D 设计约定）。
 */
@Injectable()
export class AdminDictsService {
  private readonly logger = new Logger(AdminDictsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 字典列表（按类型，关键词/状态筛选 + 分页） */
  async list(query: AdminDictQuery) {
    const where: Prisma.DictItemWhereInput = { type: query.type as DictType };
    const kw = query.keyword?.trim();
    if (kw) {
      where.OR = [
        { name: { contains: kw, mode: 'insensitive' } },
        { code: { contains: kw, mode: 'insensitive' } },
        { nameEn: { contains: kw, mode: 'insensitive' } },
      ];
    }
    if (query.enabled === 'true' || query.enabled === 'false') {
      where.enabled = query.enabled === 'true';
    }

    const params = parsePageParams(String(query.page), String(query.pageSize));
    const [total, rows] = await Promise.all([
      this.prisma.dictItem.count({ where }),
      this.prisma.dictItem.findMany({
        where,
        orderBy: [{ sort: 'asc' }, { code: 'asc' }],
        skip: params.skip,
        take: params.take,
      }),
    ]);
    return buildPageResult(rows, total, params);
  }

  /** 新增字典项（(type, code) 唯一） */
  async create(input: AdminDictCreate) {
    await this.assertCodeUnique(input.type, input.code);
    const row = await this.prisma.dictItem.create({
      data: {
        type: input.type,
        code: input.code,
        name: input.name,
        nameEn: input.nameEn ?? null,
        parentCode: input.parentCode ?? null,
        remark: input.remark ?? null,
        sort: input.sort ?? 0,
        enabled: input.enabled ?? true,
      },
    });
    this.logger.log(`管理端新增字典项: type=${input.type} code=${input.code} id=${row.id}`);
    return row;
  }

  /** 编辑字典项（type/code 不可改） */
  async update(id: string, input: AdminDictUpdate) {
    const existing = await this.prisma.dictItem.findUnique({ where: { id } });
    if (!existing) {
      throw new BizException(ErrorCode.NOT_FOUND, '字典项不存在', HttpStatus.NOT_FOUND);
    }
    const row = await this.prisma.dictItem.update({
      where: { id },
      data: {
        name: input.name,
        nameEn: input.nameEn ?? null,
        parentCode: input.parentCode ?? null,
        remark: input.remark ?? null,
        sort: input.sort ?? 0,
      },
    });
    this.logger.log(`管理端编辑字典项: id=${id}`);
    return row;
  }

  /** 停用/启用字典项 */
  async setEnabled(id: string, input: AdminDictEnabled) {
    const existing = await this.prisma.dictItem.findUnique({ where: { id } });
    if (!existing) {
      throw new BizException(ErrorCode.NOT_FOUND, '字典项不存在', HttpStatus.NOT_FOUND);
    }
    const row = await this.prisma.dictItem.update({
      where: { id },
      data: { enabled: input.enabled },
    });
    this.logger.log(`管理端${input.enabled ? '启用' : '停用'}字典项: id=${id}`);
    return { id: row.id, enabled: row.enabled };
  }

  /** (type, code) 唯一性校验 */
  private async assertCodeUnique(type: string, code: string): Promise<void> {
    const dup = await this.prisma.dictItem.findUnique({
      where: { type_code: { type: type as DictType, code } },
    });
    if (dup) {
      throw new BizException(ErrorCode.CONFLICT, '该类型下编码已存在', HttpStatus.CONFLICT);
    }
  }
}
