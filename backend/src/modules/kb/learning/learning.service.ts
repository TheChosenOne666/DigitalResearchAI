import { Injectable, Logger } from '@nestjs/common';
import type { DocMimeType } from '../parse/doc-parser.service';
import { DocParserService } from '../parse/doc-parser.service';
import { chunkText } from '../chunk/chunker';
import { EmbedService } from '../embeddings/embed.service';
import { QdrantService } from '../vector/qdrant.service';
import { KbStoreService } from '../store/kb.store.service';

/** 学习任务载荷（队列/上传/重新学习共用） */
export interface LearnDocumentPayload {
  tenantId: string;
  documentId: string;
  /** 文档原始字节（Base64，跨进程传输） */
  bufferBase64?: string;
  /** mimeType */
  mimeType: DocMimeType;
}

/**
 * 文档学习编排服务（M3.2 核心）：
 * 解析 → 切片 → 向量化(可选) → 写 Qdrant + PG → 状态流转。
 * 作为纯服务暴露，既被 BullMQ 队列 worker 调用，也可被测试直接调用。
 * 状态机：LEARNING → READY（成功）/ FAILED（失败）；中断由外层捕获。
 */
@Injectable()
export class KbLearningService {
  private readonly logger = new Logger(KbLearningService.name);

  constructor(
    private readonly parser: DocParserService,
    private readonly embed: EmbedService,
    private readonly qdrant: QdrantService,
    private readonly store: KbStoreService,
  ) {}

  /** 执行一次完整学习；成功返回切片数，失败抛错（由调用方决定置 FAILED 或重试） */
  async learn(payload: LearnDocumentPayload): Promise<number> {
    const { tenantId, documentId } = payload;
    const lib = await this.store.getDocumentLibrary(tenantId, documentId);
    if (!lib) {
      throw new Error(`文档不存在: ${documentId}`);
    }

    // 1. 标记学习进行中（原恢复：之前是 LEARNING 则维持）
    await this.store.updateDocumentStatus(tenantId, documentId, 'LEARNING');

    // 2. 重新学习前清理旧切片与旧向量
    const oldVectorIds = await this.store.deleteDocumentChunks(tenantId, documentId);
    await this.clearVectors(tenantId, lib.libraryId, oldVectorIds);

    // 3. 解析为纯文本：优先队列载荷中的字节，否则回读落库原件（重学/续学）
    let buffer = payload.bufferBase64
      ? Buffer.from(payload.bufferBase64, 'base64')
      : await this.store.getDocumentFile(tenantId, documentId);
    if (!buffer) {
      throw new Error('原始文件缺失，无法学习');
    }
    const text = await this.parser.parse(payload.mimeType, buffer);

    // 4. 切片
    const chunks = chunkText(text, {
      mode: lib.chunkMode as 'FIXED' | 'SMART',
      size: lib.chunkSize,
      overlap: lib.chunkOverlap,
    });
    if (!chunks.length) throw new Error('文档内容为空，无切片可生成');

    // 5. 向量化（可选：无 Key 时 embed.enabled=false → 跳过）
    const vectorByIndex = new Map<number, number[]>();
    if (this.embed.enabled) {
      try {
        this.logger.debug(`文档 ${documentId} 向量化 ${chunks.length} 个切片，模型 ${lib.embedModel}`);
        const vectors = await this.embed.embed(chunks.map((c) => c.content));
        chunks.forEach((c, i) => vectorByIndex.set(c.index, vectors[i]));
        await this.qdrant.ensureCollection(tenantId, lib.libraryId, vectors[0]?.length ?? 0);
      } catch (e) {
        // 向量化失败 → 退纯全文（不阻断），记录警告
        this.logger.warn(`文档 ${documentId} 向量化失败，退纯全文：${(e as Error).message}`);
        vectorByIndex.clear();
      }
    }

    // 6. 写 PG 切片（groupId 跟随文档所在分组）
    const created = await this.store.writeChunks(
      chunks.map((c) => ({
        tenantId,
        documentId,
        libraryId: lib.libraryId,
        groupId: lib.groupId,
        index: c.index,
        content: c.content,
        keywords: null,
      })),
    );

    // 7. 写 Qdrant（若有向量），回填 vectorId
    const vectorUpdates: Array<{ chunkId: string; vectorId: string }> = [];
    if (vectorByIndex.size) {
      // chunks 按 index 升序，created 亦按同序创建，下标一一对应
      const points: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }> = [];
      for (const c of chunks) {
        const vec = vectorByIndex.get(c.index);
        if (!vec) continue;
        points.push({
          id: created[c.index].id,
          vector: vec,
          payload: { tenantId, libraryId: lib.libraryId, documentId, groupId: lib.groupId, index: c.index },
        });
      }
      if (points.length) {
        await this.qdrant.upsert(tenantId, lib.libraryId, points);
        vectorUpdates.push(...points.map((p) => ({ chunkId: p.id, vectorId: p.id })));
        // chunkId 与 vectorId 取值同 id（Qdrant point id = 切片主键）
        await this.store.setChunkVectorIds(vectorUpdates);
      }
    }

    // 8. 标记就绪
    await this.store.updateDocumentStatus(tenantId, documentId, 'READY', {
      chunkCount: chunks.length,
    });
    return chunks.length;
  }

  /** 清理一批向量点（忽略 Qdrant 异常） */
  private async clearVectors(tenantId: string, libraryId: string, vectorIds: string[]): Promise<void> {
    if (!vectorIds.length) return;
    try {
      await this.qdrant.deleteByIds(tenantId, libraryId, vectorIds);
    } catch (e) {
      this.logger.warn(`清理向量失败（忽略）：${(e as Error).message}`);
    }
  }

  /** 标记文档学习失败（worker 捕获异常时调用） */
  async markFailed(tenantId: string, documentId: string, reason: string): Promise<void> {
    await this.store.updateDocumentStatus(tenantId, documentId, 'FAILED', {
      failReason: reason.slice(0, 500),
    });
    this.logger.warn(`文档学习失败: ${documentId} → ${reason}`);
  }
}