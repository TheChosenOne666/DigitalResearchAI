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

  // ===== 学习流程（供 processor 后台线程使用，显式 tenant_id 走系统 client） =====

  /** 创建文档记录（上传/入库时，原始字节一并落库供重学）。返回文档 id */
  async createDocument(input: {
    tenantId: string;
    libraryId: string;
    groupId: string | null;
    name: string;
    mimeType: string;
    size: number;
    buffer?: Buffer;
    tags?: unknown;
    sourceSessionId?: string | null;
  }): Promise<{ id: string }> {
    const doc = await this.prisma.kbDocument.create({
      data: {
        tenantId: input.tenantId,
        libraryId: input.libraryId,
        groupId: input.groupId,
        name: input.name,
        mimeType: input.mimeType,
        size: input.size,
        fileData: input.buffer ? new Uint8Array(input.buffer) : null,
        tags: input.tags ? (input.tags as any) : undefined,
        sourceSessionId: input.sourceSessionId ?? null,
      },
    });
    return { id: doc.id };
  }

  /** 回读文档原始文件字节（重学/中断续学用；系统 client，显式 tenantId） */
  async getDocumentFile(tenantId: string, documentId: string): Promise<Buffer | null> {
    const doc = await this.prisma.kbDocument.findFirst({
      where: { id: documentId, tenantId },
      select: { fileData: true },
    });
    if (!doc?.fileData) return null;
    return Buffer.from(doc.fileData as unknown as Uint8Array);
  }

  /** 更新文档状态（后台线程用，显式 tenantId） */
  async updateDocumentStatus(
    tenantId: string,
    documentId: string,
    status: string,
    extra?: { failReason?: string; chunkCount?: number },
  ): Promise<void> {
    const data: Prisma.KbDocumentUpdateInput = { status: status as any };
    if (extra?.failReason !== undefined) data.failReason = extra.failReason;
    if (extra?.chunkCount !== undefined) data.chunkCount = extra.chunkCount;
    await this.prisma.kbDocument.updateMany({
      where: { id: documentId, tenantId },
      data,
    });
    this.logger.debug(`文档 ${documentId} 状态 → ${status}`);
  }

  /** 启动清理：把上次进程遗留的 LEARNING 文档置 INTERRUPTED（跨租户，系统 client）。返回受影响行数 */
  async markStuckLearningInterrupted(): Promise<number> {
    const r = await this.prisma.kbDocument.updateMany({
      where: { status: 'LEARNING' },
      data: { status: 'INTERRUPTED' },
    });
    if (r.count > 0) {
      this.logger.warn(`启动清理：${r.count} 个 LEARNING 文档置为 INTERRUPTED（可继续学习）`);
    }
    return r.count;
  }

  /** 读取文档的库配置（后台线程在写入前需读取库的切片/索引配置），并带出文档分组 */
  async getDocumentLibrary(
    tenantId: string,
    documentId: string,
  ): Promise<{
    libraryId: string;
    groupId: string | null;
    chunkMode: string;
    chunkSize: number;
    chunkOverlap: number;
    embedModel: string;
    topK: number;
    threshold: number;
    weight: number;
  } | null> {
    const doc = await this.prisma.kbDocument.findFirst({
      where: { id: documentId, tenantId },
      include: { library: true },
    });
    if (!doc) return null;
    return {
      libraryId: doc.libraryId,
      groupId: doc.groupId,
      chunkMode: doc.library.chunkMode,
      chunkSize: doc.library.chunkSize,
      chunkOverlap: doc.library.chunkOverlap,
      embedModel: doc.library.embedModel,
      topK: doc.library.topK,
      threshold: doc.library.threshold,
      weight: doc.library.weight,
    };
  }

  /** 删除文档全部切片（重新学习前清理，显式 tenantId；级联向量由调用侧负责） */
  async deleteDocumentChunks(tenantId: string, documentId: string): Promise<string[]> {
    const chunks = await this.prisma.kbChunk.findMany({
      where: { documentId, tenantId },
      select: { id: true, vectorId: true },
    });
    await this.prisma.kbChunk.deleteMany({ where: { documentId, tenantId } });
    return chunks.filter((c) => c.vectorId).map((c) => c.vectorId as string);
  }

  /** 批量写切片（返回新切片 id + vectorId 待填的上报） */
  async writeChunks(
    list: Array<{
      tenantId: string;
      documentId: string;
      libraryId: string;
      groupId: string | null;
      index: number;
      content: string;
      keywords?: string | null;
    }>,
  ): Promise<Array<{ id: string; tenantId: string; vectorId?: string }>> {
    const created: Array<{ id: string; tenantId: string }> = [];
    for (const c of list) {
      const row = await this.prisma.kbChunk.create({
        data: {
          tenantId: c.tenantId,
          documentId: c.documentId,
          libraryId: c.libraryId,
          groupId: c.groupId,
          index: c.index,
          content: c.content,
          keywords: c.keywords ?? null,
        },
      });
      created.push({ id: row.id, tenantId: row.tenantId });
    }
    return created;
  }

  /** 回填切片的 vectorId（向量入库后） */
  async setChunkVectorIds(
    items: Array<{ chunkId: string; vectorId: string }>,
  ): Promise<void> {
    for (const { chunkId, vectorId } of items) {
      await this.prisma.kbChunk.update({
        where: { id: chunkId },
        data: { vectorId },
      });
    }
  }

  /** 读取文档切片（供召回/检索/processor 使用）。返回文档名用于 title */
  async getDocumentChunks(tenantId: string, documentId: string) {
    const doc = await this.prisma.kbChunk.findMany({
      where: { documentId, tenantId },
      orderBy: { index: 'asc' },
    });
    return doc;
  }

  // ===== 混合检索（M3.3，供 KbRetrieverService 使用） =====

  /** 租户下全部库的检索配置清单（遍历各库 collection 检索用；系统 client 显式 tenantId） */
  async listLibraryRetrievalConfigs(
    tenantId: string,
  ): Promise<Array<{ id: string; topK: number; threshold: number; weight: number }>> {
    return this.prisma.kbLibrary.findMany({
      where: { tenantId },
      select: { id: true, topK: true, threshold: true, weight: true },
    });
  }

  /** 批量读切片并带出所属文档名（向量路回填切片内容用；系统 client 显式 tenantId） */
  async getChunksWithDocNames(
    tenantId: string,
    chunkIds: string[],
  ): Promise<
    Array<{
      id: string;
      libraryId: string;
      groupId: string | null;
      documentId: string;
      index: number;
      content: string;
      documentName: string;
    }>
  > {
    if (!chunkIds.length) return [];
    const rows = await this.prisma.kbChunk.findMany({
      where: { tenantId, id: { in: chunkIds } },
      include: { document: { select: { name: true } } },
    });
    return rows.map((c) => ({
      id: c.id,
      libraryId: c.libraryId,
      groupId: c.groupId,
      documentId: c.documentId,
      index: c.index,
      content: c.content,
      documentName: c.document.name,
    }));
  }

  /** PG 全文路候选检索：多关键词 ILIKE 子串匹配，按命中词数降序取前 limit 行（系统 client 显式 tenantId） */
  async searchChunksFulltext(params: {
    tenantId: string;
    patterns: string[];
    limit: number;
  }): Promise<
    Array<{
      chunkId: string;
      libraryId: string;
      groupId: string | null;
      documentId: string;
      index: number;
      content: string;
      documentName: string;
      matchedTerms: number;
    }>
  > {
    const { tenantId, patterns, limit } = params;
    if (!patterns.length) return [];
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT c.id, c.library_id AS "libraryId", c.group_id AS "groupId",
             c.document_id AS "documentId", c."index", c.content,
             d.name AS "documentName",
             (
               SELECT count(*)
               FROM unnest(${patterns}::text[]) AS p(pat)
               WHERE c.content ILIKE p.pat
             ) AS "matchedTerms"
      FROM kb_chunks c
      JOIN kb_documents d ON d.id = c.document_id
      WHERE c.tenant_id = ${tenantId}
        AND EXISTS (
          SELECT 1 FROM unnest(${patterns}::text[]) AS p(pat)
          WHERE c.content ILIKE p.pat
        )
      ORDER BY "matchedTerms" DESC, c.created_at ASC, c."index" ASC
      LIMIT ${limit}
    `;
    // pg 驱动把 bigint 计数返回为字符串，转回数值
    return rows.map((r) => ({ ...r, matchedTerms: Number(r.matchedTerms ?? 0) })) as Array<{
      chunkId: string;
      libraryId: string;
      groupId: string | null;
      documentId: string;
      index: number;
      content: string;
      documentName: string;
      matchedTerms: number;
    }>;
  }
}