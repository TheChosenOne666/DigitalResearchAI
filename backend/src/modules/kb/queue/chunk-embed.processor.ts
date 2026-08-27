import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { KbLearningService, type LearnDocumentPayload } from '../learning/learning.service';
import { KbStoreService } from '../store/kb.store.service';

/**
 * 文档学习队列 worker（M3.2）：消费 chunk-embed 队列任务，调用学习服务完成解析→切片→向量化。
 * worker 脱离请求上下文执行，任务含 tenantId/documentId/文件字节，用系统 client 写入（显式租户隔离）。
 * bullmq 为可选依赖：未安装时会话不启动 worker（上传仍可同步学习降级）。
 */
@Injectable()
export class ChunkEmbedProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChunkEmbedProcessor.name);
  private worker: any = null;

  constructor(
    config: ConfigService,
    private readonly learning: KbLearningService,
    private readonly store: KbStoreService,
  ) {
    this.redisUrl = config.get<string>('REDIS_URL', 'redis://localhost:6380')!;
  }

  private readonly redisUrl: string;

  /** 生成 BullMQ 需要的 Redis connection 对象 */
  private connection(): { host: string; port: number; password?: string } {
    const u = new URL(this.redisUrl);
    return { host: u.hostname, port: Number(u.port || 6379), password: u.password || undefined };
  }

  /** 启动 Worker（懒加载 bullmq，未安装则跳过）；启动前把上次遗留的 LEARNING 文档置 INTERRUPTED */
  async onModuleInit(): Promise<void> {
    try {
      await this.store.markStuckLearningInterrupted();
    } catch (e) {
      this.logger.warn(`启动清理 LEARNING 文档失败：${(e as Error).message}`);
    }
    try {
      const { Worker } = await import('bullmq');
      this.worker = new Worker('chunk-embed', this.process.bind(this), {
        connection: this.connection(),
        concurrency: 2,
      });
      this.logger.log('chunk-embed Worker 已启动');
    } catch (e) {
      this.logger.warn(`BullMQ 未安装/启动失败，学习队列不可用：${(e as Error).message}`);
    }
  }

  /** 关闭 Worker */
  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  /**
   * 处理单条学习任务。
   * - 成功：learn() 内部置文档 READY；
   * - 失败：置文档 FAILED + failReason，抛错入队列失败（可重试）。
   */
  async process(job: Job<LearnDocumentPayload>): Promise<void> {
    const { tenantId, documentId } = job.data;
    this.logger.log(`文档学习开始: ${documentId} attempt=${job.attemptsMade + 1}`);
    try {
      const count = await this.learning.learn(job.data);
      this.logger.log(`文档学习完成: ${documentId} chunks=${count}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.learning
        .markFailed(tenantId, documentId, msg)
        .catch((err) => this.logger.error(`置文档 FAILED 失败: ${(err as Error).message}`));
      throw e;
    }
  }
}