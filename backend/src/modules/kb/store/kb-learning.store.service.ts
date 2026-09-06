import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

/**
 * 知识库学习流程持久化（系统态，M3.2）：供 BullMQ worker 后台线程使用。
 * worker 脱离请求上下文执行，全部方法显式传 tenantId 并走 PrismaService 本体（系统 client），
 * 与请求态 KbStoreService（forTenant 自动注入租户）形成两种隔离语义的分界。
 */
@Injectable()
export class KbLearningStoreService {
  private readonly logger = new Logger(KbLearningStoreService.name);

  constructor(private readonly prisma: PrismaService) {}

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
}
