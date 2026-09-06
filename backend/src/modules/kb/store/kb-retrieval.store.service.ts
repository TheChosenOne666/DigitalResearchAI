import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

/**
 * 知识库检索持久化（系统态，M3.3）：供 KbRetrieverService 混合检索使用。
 * 走 PrismaService 本体（系统 client）并显式传 tenantId，保证检索路与学习路同一套租户隔离语义。
 */
@Injectable()
export class KbRetrievalStoreService {
  constructor(private readonly prisma: PrismaService) {}

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
    // 检索优化（优化 A）：ILIKE 对 unnest 变量 pattern 无法在计划期提取 trigram，
    // trigram GIN 索引永远不可用；改为 OR 展开的参数化 ILIKE（Prisma.join 组合，
    // 参数逐个绑定防注入），配合 pg_trgm 索引消除全表扫描
    const conds = Prisma.join(
      patterns.map((p) => Prisma.sql`c.content ILIKE ${p}`),
      ' OR ',
    );
    const matchedSum = Prisma.join(
      patterns.map((p) => Prisma.sql`(CASE WHEN c.content ILIKE ${p} THEN 1 ELSE 0 END)`),
      ' + ',
    );
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT c.id, c.library_id AS "libraryId", c.group_id AS "groupId",
             c.document_id AS "documentId", c."index", c.content,
             d.name AS "documentName",
             (${matchedSum}) AS "matchedTerms"
      FROM kb_chunks c
      JOIN kb_documents d ON d.id = c.document_id
      WHERE c.tenant_id = ${tenantId}
        AND (${conds})
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
