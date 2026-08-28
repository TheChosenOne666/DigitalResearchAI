import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import { Prisma } from '../../generated/prisma/client';
import { parsePageParams, buildPageResult } from './pagination';
import type {
  AdminIndicatorCreate,
  AdminIndicatorUpdate,
  AdminMappingCreate,
  AdminMappingUpdate,
} from './dto';

/** 指标列表筛选条件 */
export interface AdminIndicatorQuery {
  keyword?: string;
  category?: string;
  enabled?: string;
  page: number;
  pageSize: number;
}

/** 指标行（含来源映射数量） */
export interface AdminIndicatorRow {
  id: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  definition: string | null;
  enabled: boolean;
  mappingCount: number;
  createdAt: Date;
}

/** 来源映射行 */
export interface AdminMappingRow {
  id: string;
  indicatorId: string;
  sourceName: string;
  sourceField: string;
  transform: string | null;
  enabled: boolean;
}

/**
 * 数据资源 · 指标管理服务（A-05）。
 * 平台级跨租户：注入 PrismaService 本体（D1）；被映射占用的指标禁删（转停用）。
 */
@Injectable()
export class AdminIndicatorsService {
  private readonly logger = new Logger(AdminIndicatorsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 指标列表（关键词/分类/状态筛选 + 分页，含映射数量） */
  async list(query: AdminIndicatorQuery) {
    const where: Prisma.IndicatorWhereInput = {};
    const kw = query.keyword?.trim();
    if (kw) {
      where.OR = [
        { name: { contains: kw, mode: 'insensitive' } },
        { code: { contains: kw, mode: 'insensitive' } },
      ];
    }
    if (query.category) {
      where.category = query.category;
    }
    if (query.enabled === 'true' || query.enabled === 'false') {
      where.enabled = query.enabled === 'true';
    }

    const params = parsePageParams(String(query.page), String(query.pageSize));
    const [total, rows] = await Promise.all([
      this.prisma.indicator.count({ where }),
      this.prisma.indicator.findMany({
        where,
        include: { mappings: true },
        orderBy: { code: 'asc' },
        skip: params.skip,
        take: params.take,
      }),
    ]);
    return buildPageResult(
      rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        category: r.category,
        unit: r.unit,
        definition: r.definition,
        enabled: r.enabled,
        mappingCount: r.mappings.length,
        createdAt: r.createdAt,
      })),
      total,
      params,
    );
  }

  /** 新增指标（编码全局唯一） */
  async create(input: AdminIndicatorCreate): Promise<AdminIndicatorRow> {
    await this.assertCodeUnique(input.code);
    const row = await this.prisma.indicator.create({
      data: {
        code: input.code,
        name: input.name,
        category: input.category,
        unit: input.unit,
        definition: input.definition ?? null,
        enabled: input.enabled ?? true,
      },
      include: { mappings: true },
    });
    this.logger.log(`管理端新增指标: code=${row.code} id=${row.id}`);
    return this.toRow(row);
  }

  /** 编辑指标（编码唯一，排除自身） */
  async update(id: string, input: AdminIndicatorUpdate): Promise<AdminIndicatorRow> {
    const existing = await this.prisma.indicator.findUnique({ where: { id } });
    if (!existing) {
      throw new BizException(ErrorCode.NOT_FOUND, '指标不存在', HttpStatus.NOT_FOUND);
    }
    if (input.code && input.code !== existing.code) {
      await this.assertCodeUnique(input.code, id);
    }
    const row = await this.prisma.indicator.update({
      where: { id },
      data: {
        ...(input.code ? { code: input.code } : {}),
        ...(input.name ? { name: input.name } : {}),
        ...(input.category ? { category: input.category } : {}),
        ...(input.unit ? { unit: input.unit } : {}),
        ...(input.definition !== undefined ? { definition: input.definition ?? null } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      },
      include: { mappings: true },
    });
    this.logger.log(`管理端编辑指标: id=${id}`);
    return this.toRow(row);
  }

  /**
   * 删除指标：被来源映射占用时禁止删除（提示转停用），无映射则直接删除。
   */
  async remove(id: string): Promise<{ ok: boolean }> {
    const existing = await this.prisma.indicator.findUnique({
      where: { id },
      include: { mappings: { select: { id: true } } },
    });
    if (!existing) {
      throw new BizException(ErrorCode.NOT_FOUND, '指标不存在', HttpStatus.NOT_FOUND);
    }
    if (existing.mappings.length > 0) {
      throw new BizException(
        ErrorCode.CONFLICT,
        '该指标存在来源映射，禁止删除，请停用代替',
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.indicator.delete({ where: { id } });
    this.logger.log(`管理端删除指标: id=${id}`);
    return { ok: true };
  }

  /** 来源映射列表（按所属指标） */
  async listMappings(indicatorId: string): Promise<AdminMappingRow[]> {
    const indicator = await this.prisma.indicator.findUnique({ where: { id: indicatorId } });
    if (!indicator) {
      throw new BizException(ErrorCode.NOT_FOUND, '指标不存在', HttpStatus.NOT_FOUND);
    }
    return this.prisma.indicatorMapping.findMany({
      where: { indicatorId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** 新增来源映射 */
  async createMapping(indicatorId: string, input: AdminMappingCreate): Promise<AdminMappingRow> {
    const indicator = await this.prisma.indicator.findUnique({ where: { id: indicatorId } });
    if (!indicator) {
      throw new BizException(ErrorCode.NOT_FOUND, '指标不存在', HttpStatus.NOT_FOUND);
    }
    const row = await this.prisma.indicatorMapping.create({
      data: {
        indicatorId,
        sourceName: input.sourceName,
        sourceField: input.sourceField,
        transform: input.transform ?? null,
        enabled: input.enabled ?? true,
      },
    });
    this.logger.log(`管理端新增映射: indicator=${indicatorId} source=${input.sourceName}`);
    return row;
  }

  /** 编辑来源映射 */
  async updateMapping(mid: string, input: AdminMappingUpdate): Promise<AdminMappingRow> {
    const existing = await this.prisma.indicatorMapping.findUnique({ where: { id: mid } });
    if (!existing) {
      throw new BizException(ErrorCode.NOT_FOUND, '映射不存在', HttpStatus.NOT_FOUND);
    }
    const row = await this.prisma.indicatorMapping.update({
      where: { id: mid },
      data: {
        ...(input.sourceName ? { sourceName: input.sourceName } : {}),
        ...(input.sourceField ? { sourceField: input.sourceField } : {}),
        ...(input.transform !== undefined ? { transform: input.transform ?? null } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      },
    });
    this.logger.log(`管理端编辑映射: id=${mid}`);
    return row;
  }

  /** 删除来源映射 */
  async removeMapping(mid: string): Promise<{ ok: boolean }> {
    const existing = await this.prisma.indicatorMapping.findUnique({ where: { id: mid } });
    if (!existing) {
      throw new BizException(ErrorCode.NOT_FOUND, '映射不存在', HttpStatus.NOT_FOUND);
    }
    await this.prisma.indicatorMapping.delete({ where: { id: mid } });
    this.logger.log(`管理端删除映射: id=${mid}`);
    return { ok: true };
  }

  /** 指标行转换 */
  private toRow(r: {
    id: string;
    code: string;
    name: string;
    category: string;
    unit: string;
    definition: string | null;
    enabled: boolean;
    createdAt: Date;
    mappings: unknown[];
  }): AdminIndicatorRow {
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      category: r.category,
      unit: r.unit,
      definition: r.definition,
      enabled: r.enabled,
      mappingCount: r.mappings.length,
      createdAt: r.createdAt,
    };
  }

  /** 编码唯一性校验（排除指定指标） */
  private async assertCodeUnique(code: string, excludeId?: string): Promise<void> {
    const dup = await this.prisma.indicator.findFirst({
      where: { code, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    });
    if (dup) {
      throw new BizException(ErrorCode.CONFLICT, '指标编码已存在', HttpStatus.CONFLICT);
    }
  }
}
