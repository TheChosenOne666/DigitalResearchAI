import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';

/**
 * 知识分类与标签管理服务（A-17）：层级分类（上限 3 级）+ 使用计数排序的标签库。
 * 分类/标签为平台级公共数据，走 PrismaService 本体（系统 client）。
 */
@Injectable()
export class KbTaxonomyAdminService {
  private readonly logger = new Logger(KbTaxonomyAdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 分类列表（全量平铺，含层级/父级，前端组树） */
  async listCategories() {
    return this.prisma.kbCategory.findMany({ orderBy: [{ level: 'asc' }, { sort: 'asc' }, { name: 'asc' }] });
  }

  /** 新增分类（层级上限 3 级） */
  async createCategory(input: { name: string; parentId?: string; sort?: number }) {
    let level = 1;
    if (input.parentId) {
      const parent = await this.prisma.kbCategory.findUnique({ where: { id: input.parentId } });
      if (!parent) {
        throw new BizException(ErrorCode.NOT_FOUND, '上级分类不存在', HttpStatus.NOT_FOUND);
      }
      level = parent.level + 1;
      if (level > 3) {
        throw new BizException(ErrorCode.VALIDATION_FAILED, '分类层级上限 3 级', HttpStatus.BAD_REQUEST);
      }
    }
    const created = await this.prisma.kbCategory.create({
      data: { name: input.name, parentId: input.parentId ?? null, level, sort: input.sort ?? 0 },
    });
    this.logger.log(`管理端新增知识分类：id=${created.id} level=${level}`);
    return created;
  }

  /** 编辑分类（名称/排序；不可移动层级） */
  async updateCategory(id: string, input: { name?: string; sort?: number }) {
    const cat = await this.prisma.kbCategory.findUnique({ where: { id } });
    if (!cat) {
      throw new BizException(ErrorCode.NOT_FOUND, '分类不存在', HttpStatus.NOT_FOUND);
    }
    return this.prisma.kbCategory.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.sort !== undefined ? { sort: input.sort } : {}),
      },
    });
  }

  /** 分类停用/启用 */
  async setCategoryEnabled(id: string, enabled: boolean) {
    const cat = await this.prisma.kbCategory.findUnique({ where: { id } });
    if (!cat) {
      throw new BizException(ErrorCode.NOT_FOUND, '分类不存在', HttpStatus.NOT_FOUND);
    }
    const updated = await this.prisma.kbCategory.update({ where: { id }, data: { enabled } });
    this.logger.log(`管理端${enabled ? '启用' : '停用'}知识分类：id=${id}`);
    return { id: updated.id, enabled: updated.enabled };
  }

  /** 标签列表 */
  async listTags() {
    return this.prisma.kbTag.findMany({ orderBy: [{ useCount: 'desc' }, { name: 'asc' }] });
  }

  /** 新增标签（名称唯一） */
  async createTag(input: { name: string }) {
    const dup = await this.prisma.kbTag.findUnique({ where: { name: input.name } });
    if (dup) {
      throw new BizException(ErrorCode.CONFLICT, '标签名已存在', HttpStatus.CONFLICT);
    }
    const created = await this.prisma.kbTag.create({ data: { name: input.name } });
    this.logger.log(`管理端新增知识标签：id=${created.id}`);
    return created;
  }

  /** 编辑标签（改名需唯一） */
  async updateTag(id: string, input: { name?: string }) {
    const tag = await this.prisma.kbTag.findUnique({ where: { id } });
    if (!tag) {
      throw new BizException(ErrorCode.NOT_FOUND, '标签不存在', HttpStatus.NOT_FOUND);
    }
    if (input.name !== undefined && input.name !== tag.name) {
      const dup = await this.prisma.kbTag.findUnique({ where: { name: input.name } });
      if (dup) {
        throw new BizException(ErrorCode.CONFLICT, '标签名已存在', HttpStatus.CONFLICT);
      }
    }
    return this.prisma.kbTag.update({ where: { id }, data: input.name !== undefined ? { name: input.name } : {} });
  }

  /** 标签停用/启用 */
  async setTagEnabled(id: string, enabled: boolean) {
    const tag = await this.prisma.kbTag.findUnique({ where: { id } });
    if (!tag) {
      throw new BizException(ErrorCode.NOT_FOUND, '标签不存在', HttpStatus.NOT_FOUND);
    }
    const updated = await this.prisma.kbTag.update({ where: { id }, data: { enabled } });
    this.logger.log(`管理端${enabled ? '启用' : '停用'}知识标签：id=${id}`);
    return { id: updated.id, enabled: updated.enabled };
  }
}
