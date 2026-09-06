import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job, Queue } from 'bullmq';
import type { LearnDocumentPayload } from '../learning/learning.service';

/** 学习队列名（生产者/消费者/指标轮询共用） */
export const LEARN_QUEUE_NAME = 'chunk-embed';

/** 死信队列名（最终失败任务留存排查，无 worker 消费） */
export const LEARN_DLQ_NAME = 'chunk-embed-dlq';

/** 死信留存时长（毫秒）：到期由清理定时器回收，防 Redis 无界增长 */
export const DLQ_RETENTION_MS = 7 * 24 * 3600 * 1000;

/** 死信清理执行间隔（毫秒） */
export const DLQ_CLEAN_INTERVAL_MS = 3600 * 1000;

/**
 * 学习队列共享工厂与入队参数（BullMQ 可靠性优化）：
 * - 幂等：jobId = learn:{documentId}，重试等待期内重复提交（重复点击重学/审核重触发）被 BullMQ 去重，不重复执行；
 * - removeOnComplete: true 任务完成即删除并释放 jobId → 重新学习可再次入队；
 * - removeOnFail: true 最终失败即删除并释放 jobId（现场转存死信队列）→ failed set 不堆积、不阻塞该文档重学。
 */
const logger = new Logger('LearnQueue');

/** 从 REDIS_URL 解析 BullMQ connection 配置（全项目统一端口约定见 .env.example） */
export function learnQueueConnection(config: ConfigService): {
  host: string;
  port: number;
  password?: string;
} {
  const url = config.get<string>('REDIS_URL', 'redis://localhost:6380')!;
  const u = new URL(url);
  return { host: u.hostname, port: Number(u.port || 6379), password: u.password || undefined };
}

/** 创建学习队列实例（懒加载 bullmq；不可用返回 null，由调用方降级同步学习） */
export async function createLearnQueue(config: ConfigService): Promise<Queue | null> {
  try {
    const { Queue } = await import('bullmq');
    return new Queue(LEARN_QUEUE_NAME, { connection: learnQueueConnection(config) });
  } catch (e) {
    logger.warn(`BullMQ 不可用（${(e as Error).message}），学习任务将降级同步执行`);
    return null;
  }
}

/**
 * 提交学习任务（统一入队参数）：返回是否成功入队。
 * 同 jobId 存活期内重复 add 会被 BullMQ 去重（返回已存在任务），视为提交成功。
 */
export async function submitLearnJob(
  queue: Queue,
  payload: LearnDocumentPayload,
): Promise<boolean> {
  const job = await queue.add('learn', payload, {
    jobId: `learn:${payload.documentId}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: true,
    removeOnFail: true,
  });
  return Boolean(job?.id);
}

/** 判定 failed 事件是否为最终失败（重试耗尽）；中间失败仍会重试，不转死信 */
export function isFinalFailure(job: Pick<Job, 'attemptsMade' | 'opts'>): boolean {
  const maxAttempts = job.opts?.attempts ?? 1;
  return job.attemptsMade >= maxAttempts;
}

/** 死信载荷：保留原任务全部现场（payload/原因/次数/时间）供排查与手动重放 */
export interface LearnDlqPayload {
  originalJobId: string;
  name: string;
  payload: LearnDocumentPayload;
  failedReason: string;
  attemptsMade: number;
  failedAt: string;
}

/** 构造死信载荷（failed 事件处理器使用） */
export function buildDlqPayload(
  job: Pick<Job, 'id' | 'name' | 'data' | 'attemptsMade'>,
  err: Error,
): LearnDlqPayload {
  return {
    originalJobId: String(job.id),
    name: job.name,
    payload: job.data as LearnDocumentPayload,
    failedReason: err.message.slice(0, 500),
    attemptsMade: job.attemptsMade,
    failedAt: new Date().toISOString(),
  };
}

/**
 * 转投死信队列（failed 事件处理器使用）：不设 jobId（同一文档可能多次最终失败，自动 id 防覆盖）。
 * 转投失败仅记日志，不影响 worker 主流程。
 */
export async function transferToDlq(
  dlq: Queue,
  job: Pick<Job, 'id' | 'name' | 'data' | 'attemptsMade'>,
  err: Error,
): Promise<void> {
  const entry = buildDlqPayload(job, err);
  await dlq.add('dead', entry, { removeOnComplete: true });
  logger.error(
    `学习任务最终失败已转死信：doc=${entry.payload.documentId} attempts=${entry.attemptsMade} reason=${entry.failedReason}`,
  );
}

/** 清理过期死信（留存期外的 waiting 任务）；无死信或清理异常仅记日志 */
export async function cleanExpiredDlq(dlq: Queue): Promise<void> {
  try {
    const removed = await dlq.clean(DLQ_RETENTION_MS, 1000, 'wait');
    if (removed.length > 0) {
      logger.log(`死信清理：回收 ${removed.length} 条过期任务（留存 ${DLQ_RETENTION_MS / 86400000} 天）`);
    }
  } catch (e) {
    logger.warn(`死信清理失败（忽略）：${(e as Error).message}`);
  }
}
