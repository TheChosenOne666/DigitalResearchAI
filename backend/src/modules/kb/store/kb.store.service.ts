import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { getTenantContext } from '../../../common/auth/tenant-context';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { BizException } from '../../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import { Prisma } from '../../../generated/prisma/client';

/** 库 + 统计（文档数/学习完成数） */
export interface LibraryWithStats {
  id: string;
  name: string;
  visibility: string;
  color: string;
  description: string | null;
  topK: number;
  threshold: number;
  weight: number;
  chunkMode: string;
  chunkSize: number;
  chunkOverlap: number;
  embedModel: string;
  createdAt: Date;
  docCount: number;
  readyCount: number;
}

/** 分组 + 文档数 */
export interface GroupWithCount {
  id: string;
  name: string;
  createdAt: Date;
  docCount: number;
}

/** 文档列表项 */
export interface DocumentListItem {
  id: string;
  groupId: string | null;
  libraryId: string;
  name: string;
  mimeType: string;
  size: number;
  status: string;
  failReason: string | null;
  chunkCount: number;
  createdAt: Date;
}

/** 文档详情（含切片） */
export interface DocumentDetail {
  id: string;
  groupId: string | null;
  libraryId: string;
  name: string;
  mimeType: string;
  size: number;
  status: string;
  failReason: string | null;
  chunkCount: number;
  createdAt: Date;
  chunks: Array<{ id: string; index: number; content: string; vectorId: string | null }>;
}

/** 创建库入参 */
export interface LibraryInput {
  name: string;
  visibility?: string;
  color?: string;
  description?: string | null;
}

/** 更新库入参（仅传需要修改的字段） */
export interface LibraryUpdate {
  name?: string;
  visibility?: string;
  color?: string;
  description?: string | null;
  topK?: number;
  threshold?: number;
  weight?: number;
  chunkMode?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  embedModel?: string;
}

/** 创建分组入参 */
export interface GroupInput {
  name: string;
}

/** 文档列表筛选 */
export interface DocumentFilter {
  groupId?: string;
  status?: string;
}

/**
 * 知识库持久化服务（M3.1）：库/分组/文档 CRUD。
 * 四表统一经 `PrismaService.forTenant`（租户 Extension 自动注入 tenant_id）保证行级隔离；
 * 无独立租户列的关联模型（分组/切片）通过所属库/文档的嵌套/查询 context 兜底隔离。
 */
@Injectable()
export class KbStoreService {
  private readonly logger = new Logger(KbStoreService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 当前请求租户上下文（受保护路由由拦截器注入；缺失视为未授权） */
  private requireTenant(): { tenantId: string } {
    const ctx = getTenantContext();
    if (!ctx) {
      throw new BizException(ErrorCode.UNAUTHORIZED, '缺少租户上下文', HttpStatus.UNAUTHORIZED);
    }
    return { tenantId: ctx.tenantId };
  }

  /** 断言库归属当前租户，返回库（跨租户抛 404） */
  private async assertLibraryOwned(libraryId: string): Promise<void> {
    const lib = await this.prisma.forTenant.kbLibrary.findFirst({ where: { id: libraryId } });
    if (!lib) {
      throw new BizException(ErrorCode.NOT_FOUND, '知识库不存在', HttpStatus.NOT_FOUND);
    }
  }

  // ===== 库 =====

  /** 创建库（tenant_id 由租户 Extension 注入） */
  async createLibrary(input: LibraryInput): Promise<{ id: string }> {
    const { tenantId } = this.requireTenant();
    const lib = await this.prisma.forTenant.kbLibrary.create({
      data: {
        tenantId,
        name: input.name,
        visibility: (input.visibility as any) ?? 'PRIVATE',
        color: input.color ?? '#16675f',
        description: input.description ?? null,
      },
    });
    return { id: lib.id };
  }

  /** 库列表（含文档数与学习完成数） */
  async listLibraries(): Promise<LibraryWithStats[]> {
    const libs = await this.prisma.forTenant.kbLibrary.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        documents: { select: { id: true, status: true } },
      },
    });
    return libs.map((lib) => ({
      id: lib.id,
      name: lib.name,
      visibility: lib.visibility,
      color: lib.color,
      description: lib.description,
      topK: lib.topK,
      threshold: lib.threshold,
      weight: lib.weight,
      chunkMode: lib.chunkMode,
      chunkSize: lib.chunkSize,
      chunkOverlap: lib.chunkOverlap,
      embedModel: lib.embedModel,
      createdAt: lib.createdAt,
      docCount: lib.documents.length,
      readyCount: lib.documents.filter((d) => d.status === 'READY').length,
    }));
  }

  /** 库详情（含配置） */
  async getLibrary(libraryId: string): Promise<LibraryWithStats | null> {
    const lib = await this.prisma.forTenant.kbLibrary.findFirst({
      where: { id: libraryId },
      include: { documents: { select: { id: true, status: true } } },
    });
    if (!lib) return null;
    return {
      id: lib.id,
      name: lib.name,
      visibility: lib.visibility,
      color: lib.color,
      description: lib.description,
      topK: lib.topK,
      threshold: lib.threshold,
      weight: lib.weight,
      chunkMode: lib.chunkMode,
      chunkSize: lib.chunkSize,
      chunkOverlap: lib.chunkOverlap,
      embedModel: lib.embedModel,
      createdAt: lib.createdAt,
      docCount: lib.documents.length,
      readyCount: lib.documents.filter((d) => d.status === 'READY').length,
    };
  }

  /** 更新库（含检索/向量化配置） */
  async updateLibrary(libraryId: string, input: LibraryUpdate): Promise<{ id: string }> {
    await this.assertLibraryOwned(libraryId);
    const data: Prisma.KbLibraryUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.visibility !== undefined) data.visibility = input.visibility as any;
    if (input.color !== undefined) data.color = input.color;
    if (input.description !== undefined) data.description = input.description;
    if (input.topK !== undefined) data.topK = input.topK;
    if (input.threshold !== undefined) data.threshold = input.threshold;
    if (input.weight !== undefined) data.weight = input.weight;
    if (input.chunkMode !== undefined) data.chunkMode = input.chunkMode as any;
    if (input.chunkSize !== undefined) data.chunkSize = input.chunkSize;
    if (input.chunkOverlap !== undefined) data.chunkOverlap = input.chunkOverlap;
    if (input.embedModel !== undefined) data.embedModel = input.embedModel;
    const lib = await this.prisma.forTenant.kbLibrary.update({ where: { id: libraryId }, data });
    return { id: lib.id };
  }

  /** 删除库（级联分组/文档/切片） */
  async deleteLibrary(libraryId: string): Promise<void> {
    await this.assertLibraryOwned(libraryId);
    await this.prisma.forTenant.kbLibrary.delete({ where: { id: libraryId } });
  }

  // ===== 分组 =====

  /** 分组列表（含文档数） */
  async listGroups(libraryId: string): Promise<GroupWithCount[]> {
    await this.assertLibraryOwned(libraryId);
    const groups = await this.prisma.forTenant.kbGroup.findMany({
      where: { libraryId },
      orderBy: { createdAt: 'asc' },
      include: { documents: { select: { id: true } } },
    });
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      createdAt: g.createdAt,
      docCount: g.documents.length,
    }));
  }

  /** 创建分组（tenant_id 由租户 Extension 注入） */
  async createGroup(libraryId: string, input: GroupInput): Promise<{ id: string }> {
    await this.assertLibraryOwned(libraryId);
    const { tenantId } = this.requireTenant();
    const group = await this.prisma.forTenant.kbGroup.create({
      data: { tenantId, libraryId, name: input.name },
    });
    return { id: group.id };
  }

  /** 更新分组名 */
  async updateGroup(libraryId: string, groupId: string, input: GroupInput): Promise<{ id: string }> {
    await this.assertLibraryOwned(libraryId);
    const group = await this.prisma.forTenant.kbGroup.findFirst({ where: { id: groupId, libraryId } });
    if (!group) {
      throw new BizException(ErrorCode.NOT_FOUND, '分组不存在', HttpStatus.NOT_FOUND);
    }
    const updated = await this.prisma.forTenant.kbGroup.update({
      where: { id: groupId },
      data: { name: input.name },
    });
    return { id: updated.id };
  }

  /** 删除分组（组内文档 groupId 置空） */
  async deleteGroup(libraryId: string, groupId: string): Promise<void> {
    await this.assertLibraryOwned(libraryId);
    const group = await this.prisma.forTenant.kbGroup.findFirst({ where: { id: groupId, libraryId } });
    if (!group) {
      throw new BizException(ErrorCode.NOT_FOUND, '分组不存在', HttpStatus.NOT_FOUND);
    }
    await this.prisma.forTenant.kbGroup.delete({ where: { id: groupId } });
  }

  // ===== 文档 =====

  /** 文档列表（分组/状态筛选，分页） */
  async listDocuments(
    libraryId: string,
    filter: DocumentFilter,
    page: number,
    pageSize: number,
  ): Promise<{ items: DocumentListItem[]; total: number }> {
    await this.assertLibraryOwned(libraryId);
    const where: Prisma.KbDocumentWhereInput = { libraryId };
    if (filter.groupId) where.groupId = filter.groupId;
    if (filter.status) where.status = filter.status as any;
    const skip = Math.max(0, (page - 1) * pageSize);
    const [docs, total] = await Promise.all([
      this.prisma.forTenant.kbDocument.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.forTenant.kbDocument.count({ where }),
    ]);
    return {
      items: docs.map((d) => ({
        id: d.id,
        groupId: d.groupId,
        libraryId: d.libraryId,
        name: d.name,
        mimeType: d.mimeType,
        size: d.size,
        status: d.status,
        failReason: d.failReason,
        chunkCount: d.chunkCount,
        createdAt: d.createdAt,
      })),
      total,
    };
  }

  /** 文档详情（含切片） */
  async getDocument(documentId: string): Promise<DocumentDetail | null> {
    const doc = await this.prisma.forTenant.kbDocument.findFirst({
      where: { id: documentId },
      include: { chunks: { orderBy: { index: 'asc' } } },
    });
    if (!doc) return null;
    return {
      id: doc.id,
      groupId: doc.groupId,
      libraryId: doc.libraryId,
      name: doc.name,
      mimeType: doc.mimeType,
      size: doc.size,
      status: doc.status,
      failReason: doc.failReason,
      chunkCount: doc.chunkCount,
      createdAt: doc.createdAt,
      chunks: doc.chunks.map((c) => ({
        id: c.id,
        index: c.index,
        content: c.content,
        vectorId: c.vectorId,
      })),
    };
  }

  /** 删除文档（级联切片；向量清理由上层调用方负责） */
  async deleteDocument(documentId: string): Promise<void> {
    const doc = await this.prisma.forTenant.kbDocument.findFirst({ where: { id: documentId } });
    if (!doc) {
      throw new BizException(ErrorCode.NOT_FOUND, '文档不存在', HttpStatus.NOT_FOUND);
    }
    await this.prisma.forTenant.kbDocument.delete({ where: { id: documentId } });
  }
}