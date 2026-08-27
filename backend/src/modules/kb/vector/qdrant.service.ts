import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** 向量点 ID */
export interface QdrantPoint {
  /** 唯一 ID（用切片 chunkId） */
  id: string;
  /** 向量 */
  vector: number[];
  /** payload（附带元数据，供租户/库/分组/文档过滤） */
  payload: Record<string, unknown>;
}

/** 向量检索命中 */
export interface QdrantHit {
  id: string;
  /** 相似度（Qdrant score，越大越相似） */
  score: number;
  payload: Record<string, unknown>;
}

/**
 * Qdrant 向量存储服务（M3.2/M3.3）。
 * collection 命名规则：`tenant_{tenantId}_lib_{libraryId}`（每租户每库一个库，payload 内置租户/库/分组/文档过滤字段）。
 * 依赖 @qdrant/js-client-rest，动态 require 以隔离启动与测试。
 */
@Injectable()
export class QdrantService implements OnModuleInit {
  private readonly logger = new Logger(QdrantService.name);
  private readonly url: string;
  /** 懒加载的 client（避免测试时拉取模块） */
  private client: any = null;
  private readonly enabled: boolean;

  constructor(config: ConfigService) {
    this.url = config.get<string>('QDRANT_URL', 'http://localhost:6333')!.replace(/\/+$/, '');
    this.enabled = Boolean(this.url);
  }

  /** 惰性加载 & 初始化 client（首次调用时） */
  private async getClient(): Promise<any> {
    if (this.client) return this.client;
    const { QdrantClient } = await import('@qdrant/js-client-rest');
    this.client = new QdrantClient({ url: this.url });
    return this.client;
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    // 验证连通性（失败仅 warn，不阻断启动；检索时再降级）
    try {
      const client = await this.getClient();
      await client.getCollections();
    } catch (e) {
      this.logger.warn(`Qdrant 初始化失败（检索将退纯全文）：${(e as Error).message}`);
    }
  }

  /** 生成 collection 名（每租户每库） */
  collectionName(tenantId: string, libraryId: string): string {
    return `tenant_${tenantId}_lib_${libraryId}`;
  }

  /** 确保 collection 存在（按向量维度创建，若已存在则跳过） */
  async ensureCollection(tenantId: string, libraryId: string, dim: number): Promise<void> {
    const client = await this.getClient();
    const name = this.collectionName(tenantId, libraryId);
    const existing = await client.getCollections();
    const found = (existing.collections ?? []).some((c: any) => c.name === name);
    if (!found) {
      await client.createCollection(name, {
        vectors: { size: dim, distance: 'Cosine' },
      });
    }
  }

  /** upsert 向量点 */
  async upsert(tenantId: string, libraryId: string, points: QdrantPoint[]): Promise<void> {
    if (!points.length) return;
    const client = await this.getClient();
    await client.upsert(this.collectionName(tenantId, libraryId), { points });
  }

  /** 删除向量点（按 id） */
  async deleteByIds(tenantId: string, libraryId: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    const client = await this.getClient();
    try {
      await client.delete(this.collectionName(tenantId, libraryId), {
        points: ids,
      });
    } catch (e) {
      this.logger.warn(`Qdrant 删除失败（忽略）：${(e as Error).message}`);
    }
  }

  /** 向量检索 TopN（payload 已含 租户/库/分组/文档，显式过滤当前库） */
  async search(
    tenantId: string,
    libraryId: string,
    vector: number[],
    topK: number,
    filter?: Record<string, unknown>,
  ): Promise<QdrantHit[]> {
    const client = await this.getClient();
    const must: Record<string, unknown>[] = [
      { key: 'tenantId', match: { value: tenantId } },
      { key: 'libraryId', match: { value: libraryId } },
    ];
    for (const [k, v] of Object.entries(filter ?? {})) {
      must.push({ key: k, match: { value: v } });
    }
    const result = await client.search(this.collectionName(tenantId, libraryId), {
      vector,
      limit: topK,
      filter: { must },
      with_payload: true,
    });
    return (result ?? []).map((p: any) => ({
      id: String(p.id),
      score: Number(p.score ?? 0),
      payload: (p.payload ?? {}) as Record<string, unknown>,
    }));
  }

  /** 是否可用（url 已配置即视为可尝试；调用前的连通探测由 onModuleInit 完成） */
  isEnabled(): boolean {
    return this.enabled;
  }
}