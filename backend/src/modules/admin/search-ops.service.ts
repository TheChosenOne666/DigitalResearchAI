import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import { Prisma } from '../../generated/prisma/client';
import { parsePageParams, buildPageResult } from './pagination';
import type { AdminTermFlags, AdminSensitiveCreate, AdminSensitiveUpdate, AdminSensitiveEnabled } from './dto';

/** 搜索词运营列表类型 */
export type SearchTermKind = 'hot' | 'empty';

/** 敏感词列表筛选条件 */
export interface AdminSensitiveQuery {
  keyword?: string;
  enabled?: string;
  page: number;
  pageSize: number;
}

/**
 * 运营管理 · 搜索运营服务（A-10）。
 * 热门词/无结果词统计（来源于智搜落库 upsert search_terms）+ 敏感词 CRUD。
 * 仅平台管理员可操作。
 */
@Injectable()
export class AdminSearchOpsService {
  private readonly logger = new Logger(AdminSearchOpsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 搜索词统计（hot=按总频次 / empty=按无结果频次，均降序分页） */
  async listTerms(kind: SearchTermKind, page: number, pageSize: number) {
    const params = parsePageParams(String(page), String(pageSize));
    const where: Prisma.SearchTermWhereInput =
      kind === 'empty' ? { emptyCount: { gt: 0 } } : {};
    const orderBy =
      kind === 'empty'
        ? [{ emptyCount: 'desc' as const }, { lastSearchedAt: 'desc' as const }]
        : [{ totalCount: 'desc' as const }, { lastSearchedAt: 'desc' as const }];
    const [total, rows] = await Promise.all([
      this.prisma.searchTerm.count({ where }),
      this.prisma.searchTerm.findMany({ where, orderBy, skip: params.skip, take: params.take }),
    ]);
    return buildPageResult(rows, total, params);
  }

  /** 搜索词运营动作：设为快捷检索 / 加入搜索建议 */
  async setTermFlags(id: string, input: AdminTermFlags) {
    const existing = await this.prisma.searchTerm.findUnique({ where: { id } });
    if (!existing) {
      throw new BizException(ErrorCode.NOT_FOUND, '搜索词不存在', HttpStatus.NOT_FOUND);
    }
    const row = await this.prisma.searchTerm.update({
      where: { id },
      data: {
        ...(input.isQuick !== undefined ? { isQuick: input.isQuick } : {}),
        ...(input.isSuggest !== undefined ? { isSuggest: input.isSuggest } : {}),
      },
    });
    this.logger.log(`管理端设置搜索词运营标记: term=${row.term} isQuick=${row.isQuick} isSuggest=${row.isSuggest}`);
    return row;
  }

  /** 敏感词列表（关键词/状态筛选 + 分页） */
  async listSensitive(query: AdminSensitiveQuery) {
    const where: Prisma.SensitiveWordWhereInput = {};
    const kw = query.keyword?.trim();
    if (kw) {
      where.word = { contains: kw, mode: 'insensitive' };
    }
    if (query.enabled === 'true' || query.enabled === 'false') {
      where.enabled = query.enabled === 'true';
    }
    const params = parsePageParams(String(query.page), String(query.pageSize));
    const [total, rows] = await Promise.all([
      this.prisma.sensitiveWord.count({ where }),
      this.prisma.sensitiveWord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
    ]);
    return buildPageResult(rows, total, params);
  }

  /** 新增敏感词（word 唯一） */
  async createSensitive(input: AdminSensitiveCreate) {
    await this.assertWordUnique(input.word);
    const row = await this.prisma.sensitiveWord.create({
      data: { word: input.word, type: input.type },
    });
    this.logger.log(`管理端新增敏感词: word=${row.word}`);
    return row;
  }

  /** 编辑敏感词（word 唯一，排除自身） */
  async updateSensitive(id: string, input: AdminSensitiveUpdate) {
    const existing = await this.prisma.sensitiveWord.findUnique({ where: { id } });
    if (!existing) {
      throw new BizException(ErrorCode.NOT_FOUND, '敏感词不存在', HttpStatus.NOT_FOUND);
    }
    if (input.word && input.word !== existing.word) {
      await this.assertWordUnique(input.word, id);
    }
    const row = await this.prisma.sensitiveWord.update({
      where: { id },
      data: {
        ...(input.word ? { word: input.word } : {}),
        ...(input.type ? { type: input.type } : {}),
      },
    });
    this.logger.log(`管理端编辑敏感词: id=${id}`);
    return row;
  }

  /** 敏感词启用/停用 */
  async setSensitiveEnabled(id: string, input: AdminSensitiveEnabled) {
    const existing = await this.prisma.sensitiveWord.findUnique({ where: { id } });
    if (!existing) {
      throw new BizException(ErrorCode.NOT_FOUND, '敏感词不存在', HttpStatus.NOT_FOUND);
    }
    const row = await this.prisma.sensitiveWord.update({
      where: { id },
      data: { enabled: input.enabled },
    });
    this.logger.log(`管理端${input.enabled ? '启用' : '停用'}敏感词: id=${id}`);
    return { id: row.id, enabled: row.enabled };
  }

  /** 敏感词唯一性校验（排除指定词） */
  private async assertWordUnique(word: string, excludeId?: string): Promise<void> {
    const dup = await this.prisma.sensitiveWord.findFirst({
      where: { word, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    });
    if (dup) {
      throw new BizException(ErrorCode.CONFLICT, '敏感词已存在', HttpStatus.CONFLICT);
    }
  }
}
