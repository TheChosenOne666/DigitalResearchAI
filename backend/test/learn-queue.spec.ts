import { describe, it, expect, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Job, Queue } from 'bullmq';
import type { LearnDocumentPayload } from '../src/modules/kb/learning/learning.service';
import {
  LEARN_DLQ_NAME,
  LEARN_QUEUE_NAME,
  DLQ_RETENTION_MS,
  learnQueueConnection,
  submitLearnJob,
  isFinalFailure,
  buildDlqPayload,
  transferToDlq,
  cleanExpiredDlq,
} from '../src/modules/kb/queue/learn-queue';

/** 构造 ConfigService mock（按 key 返回配置值，未配置时返回默认值） */
function mockConfig(values: Record<string, string>): ConfigService {
  return {
    get: (key: string, dflt?: string) => (key in values ? values[key] : dflt),
  } as unknown as ConfigService;
}

/** 构造学习载荷 */
function payload(): LearnDocumentPayload {
  return { tenantId: 't1', documentId: 'd1', mimeType: 'md' };
}

/** 构造 Queue mock（记录 add 调用参数） */
function mockQueue() {
  const adds: Array<{ name: string; data: unknown; opts: Record<string, unknown> }> = [];
  const queue = {
    name: LEARN_QUEUE_NAME,
    add: vi.fn(async (name: string, data: unknown, opts: Record<string, unknown>) => {
      adds.push({ name, data, opts });
      return { id: `job-${adds.length}` };
    }),
    __adds: adds,
  } as unknown as Queue & { __adds: typeof adds };
  return queue;
}

describe('learnQueueConnection', () => {
  it('解析 REDIS_URL 的 host/port/password', () => {
    const conn = learnQueueConnection(mockConfig({ REDIS_URL: 'redis://:secret@redis-host:6380' }));
    expect(conn).toEqual({ host: 'redis-host', port: 6380, password: 'secret' });
  });

  it('未配置时回退默认本机 6380', () => {
    const conn = learnQueueConnection(mockConfig({}));
    expect(conn).toEqual({ host: 'localhost', port: 6380, password: undefined });
  });
});

describe('submitLearnJob（幂等入队参数）', () => {
  it('jobId 按文档去重 + 3 次指数退避 + 完成即删 + 最终失败即删', async () => {
    const queue = mockQueue();
    const ok = await submitLearnJob(queue, payload());
    expect(ok).toBe(true);
    const call = (queue as any).__adds[0];
    expect(call.name).toBe('learn');
    expect(call.data).toEqual(payload());
    expect(call.opts).toEqual({
      jobId: 'learn:d1',
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: true,
    });
  });

  it('add 未返回 job id 时视为提交失败（走降级）', async () => {
    const queue = {
      add: vi.fn(async () => undefined),
    } as unknown as Queue;
    expect(await submitLearnJob(queue, payload())).toBe(false);
  });
});

describe('isFinalFailure（重试耗尽判定）', () => {
  it('attemptsMade >= attempts 为最终失败', () => {
    expect(isFinalFailure({ attemptsMade: 3, opts: { attempts: 3 } } as Pick<Job, 'attemptsMade' | 'opts'>)).toBe(true);
  });

  it('中间失败（仍会重试）不算最终失败', () => {
    expect(isFinalFailure({ attemptsMade: 1, opts: { attempts: 3 } } as Pick<Job, 'attemptsMade' | 'opts'>)).toBe(false);
  });

  it('未配置 attempts 默认 1 次', () => {
    expect(isFinalFailure({ attemptsMade: 1, opts: {} } as Pick<Job, 'attemptsMade' | 'opts'>)).toBe(true);
    expect(isFinalFailure({ attemptsMade: 0, opts: {} } as Pick<Job, 'attemptsMade' | 'opts'>)).toBe(false);
  });
});

describe('死信转投', () => {
  /** 构造 failed 事件里的 Job 形状 */
  function failedJob() {
    return {
      id: 'learn:d1',
      name: 'learn',
      data: payload(),
      attemptsMade: 3,
    } as Pick<Job, 'id' | 'name' | 'data' | 'attemptsMade'>;
  }

  it('buildDlqPayload 保留原任务全部现场', () => {
    const err = new Error('parse failed');
    const entry = buildDlqPayload(failedJob(), err);
    expect(entry.originalJobId).toBe('learn:d1');
    expect(entry.name).toBe('learn');
    expect(entry.payload).toEqual(payload());
    expect(entry.failedReason).toBe('parse failed');
    expect(entry.attemptsMade).toBe(3);
    expect(typeof entry.failedAt).toBe('string');
  });

  it('failedReason 截断至 500 字符防日志/存储膨胀', () => {
    const err = new Error('x'.repeat(1000));
    const entry = buildDlqPayload(failedJob(), err);
    expect(entry.failedReason.length).toBe(500);
  });

  it('transferToDlq 以 dead 名称入死信队列且不设 jobId（同文档多次失败不覆盖）', async () => {
    const queue = mockQueue();
    await transferToDlq(queue, failedJob(), new Error('boom'));
    const call = (queue as any).__adds[0];
    expect(call.name).toBe('dead');
    expect(call.opts).toEqual({ removeOnComplete: true });
    expect((call.data as any).originalJobId).toBe('learn:d1');
    expect((call.data as any).failedReason).toBe('boom');
  });
});

describe('cleanExpiredDlq（死信留存清理）', () => {
  it('按留存期清理 waiting 状态死信', async () => {
    const clean = vi.fn(async () => [{ id: 'x' }]);
    const queue = { clean } as unknown as Queue;
    await cleanExpiredDlq(queue);
    expect(clean).toHaveBeenCalledWith(DLQ_RETENTION_MS, 1000, 'wait');
  });

  it('清理异常吞掉不外溢（仅日志）', async () => {
    const clean = vi.fn(async () => {
      throw new Error('redis down');
    });
    const queue = { clean } as unknown as Queue;
    await expect(cleanExpiredDlq(queue)).resolves.toBeUndefined();
  });
});

describe('队列命名约定', () => {
  it('主队列与死信队列名称固定（生产者/消费者/指标轮询共用）', () => {
    expect(LEARN_QUEUE_NAME).toBe('chunk-embed');
    expect(LEARN_DLQ_NAME).toBe('chunk-embed-dlq');
  });
});
