import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KbLearningService } from '../src/modules/kb/learning/learning.service';
import { ChunkEmbedProcessor } from '../src/modules/kb/queue/chunk-embed.processor';

/** 库配置（文档所在分组 g1） */
const LIB = {
  libraryId: 'lib1',
  groupId: 'g1',
  chunkMode: 'FIXED',
  chunkSize: 10,
  chunkOverlap: 2,
  embedModel: 'doubao-embedding-large',
  topK: 5,
  threshold: 0.4,
  weight: 1.2,
};

/** 构造被测服务与四个依赖的 mock */
function makeLearning(opts?: { embedEnabled?: boolean; embedError?: boolean }) {
  const parser = { parse: vi.fn().mockResolvedValue('一二三四五六七八九十甲乙丙丁') };
  const embed = {
    enabled: opts?.embedEnabled ?? false,
    embed: opts?.embedError
      ? vi.fn().mockRejectedValue(new Error('embedding HTTP 500'))
      : vi.fn().mockResolvedValue([
          [0.1, 0.2],
          [0.3, 0.4],
        ]),
  };
  const qdrant = {
    ensureCollection: vi.fn().mockResolvedValue(undefined),
    upsert: vi.fn().mockResolvedValue(undefined),
    deleteByIds: vi.fn().mockResolvedValue(undefined),
  };
  const store = {
    getDocumentLibrary: vi.fn().mockResolvedValue(LIB),
    updateDocumentStatus: vi.fn().mockResolvedValue(undefined),
    deleteDocumentChunks: vi.fn().mockResolvedValue([]),
    getDocumentFile: vi.fn().mockResolvedValue(null),
    writeChunks: vi
      .fn()
      .mockImplementation((list: Array<{ index: number }>) =>
        list.map((c) => ({ id: `c${c.index}`, tenantId: 't1' })),
      ),
    setChunkVectorIds: vi.fn().mockResolvedValue(undefined),
  };
  const svc = new KbLearningService(
    parser as any,
    embed as any,
    qdrant as any,
    store as any,
  );
  return { svc, parser, embed, qdrant, store };
}

const PAYLOAD = {
  tenantId: 't1',
  documentId: 'd1',
  mimeType: 'txt' as const,
  bufferBase64: Buffer.from('queue-payload-bytes').toString('base64'),
};

describe('KbLearningService.learn 状态机与切片落库', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('无 Key（降级纯全文）：LEARNING→READY，切片带文档分组', async () => {
    const { svc, store, qdrant } = makeLearning();
    const count = await svc.learn(PAYLOAD);
    // size=10/overlap=2 → step=8，16 字文本切 2 片
    expect(count).toBe(2);
    expect(store.updateDocumentStatus).toHaveBeenNthCalledWith(
      1,
      't1',
      'd1',
      'LEARNING',
    );
    expect(store.updateDocumentStatus).toHaveBeenNthCalledWith(
      2,
      't1',
      'd1',
      'READY',
      { chunkCount: 2 },
    );
    const rows = store.writeChunks.mock.calls[0][0];
    expect(rows[0]).toMatchObject({
      tenantId: 't1',
      documentId: 'd1',
      libraryId: 'lib1',
      groupId: 'g1',
      index: 0,
    });
    expect(qdrant.upsert).not.toHaveBeenCalled();
    expect(store.setChunkVectorIds).not.toHaveBeenCalled();
  });

  it('有向量：写 Qdrant（payload 带分组）并回填 vectorId', async () => {
    const { svc, qdrant, store, embed } = makeLearning({ embedEnabled: true });
    await svc.learn(PAYLOAD);
    expect(embed.embed).toHaveBeenCalledTimes(1);
    expect(qdrant.ensureCollection).toHaveBeenCalledWith('t1', 'lib1', 2);
    const points = qdrant.upsert.mock.calls[0][2];
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({
      id: 'c0',
      vector: [0.1, 0.2],
      payload: { tenantId: 't1', libraryId: 'lib1', documentId: 'd1', groupId: 'g1', index: 0 },
    });
    expect(store.setChunkVectorIds).toHaveBeenCalledWith([
      { chunkId: 'c0', vectorId: 'c0' },
      { chunkId: 'c1', vectorId: 'c1' },
    ]);
  });

  it('向量化失败不阻断：退纯全文仍 READY', async () => {
    const { svc, qdrant, store } = makeLearning({
      embedEnabled: true,
      embedError: true,
    });
    const count = await svc.learn(PAYLOAD);
    expect(count).toBe(2);
    expect(qdrant.upsert).not.toHaveBeenCalled();
    expect(store.updateDocumentStatus).toHaveBeenCalledWith('t1', 'd1', 'READY', {
      chunkCount: 2,
    });
  });

  it('重新学习先清理旧切片与旧向量', async () => {
    const { svc, store, qdrant } = makeLearning();
    store.deleteDocumentChunks.mockResolvedValue(['v1', 'v2']);
    await svc.learn(PAYLOAD);
    expect(store.deleteDocumentChunks).toHaveBeenCalledWith('t1', 'd1');
    expect(qdrant.deleteByIds).toHaveBeenCalledWith('t1', 'lib1', ['v1', 'v2']);
  });

  it('文档不存在抛错', async () => {
    const { svc, store } = makeLearning();
    store.getDocumentLibrary.mockResolvedValue(null);
    await expect(svc.learn(PAYLOAD)).rejects.toThrow(/文档不存在/);
  });

  it('解析为空文本抛错且不置 READY', async () => {
    const { svc, parser, store } = makeLearning();
    parser.parse.mockResolvedValue('');
    await expect(svc.learn(PAYLOAD)).rejects.toThrow(/无切片可生成/);
    expect(store.updateDocumentStatus).not.toHaveBeenCalledWith(
      't1',
      'd1',
      'READY',
      expect.anything(),
    );
  });

  it('载荷无字节时回读库内原件（重学/续学）', async () => {
    const { svc, parser, store } = makeLearning();
    const stored = Buffer.from('stored-original-bytes');
    store.getDocumentFile.mockResolvedValue(stored);
    parser.parse.mockResolvedValueOnce('一二三四五六七八九十甲乙');
    await svc.learn({
      tenantId: 't1',
      documentId: 'd1',
      mimeType: 'txt',
    });
    const [mime, buf] = parser.parse.mock.calls[0];
    void mime;
    expect(buf.equals(stored)).toBe(true);
  });

  it('载荷与库内原件都缺失抛「原始文件缺失」', async () => {
    const { svc, store } = makeLearning();
    await expect(
      svc.learn({ tenantId: 't1', documentId: 'd1', mimeType: 'txt' }),
    ).rejects.toThrow(/原始文件缺失/);
    expect(store.updateDocumentStatus).not.toHaveBeenCalledWith(
      't1',
      'd1',
      'READY',
      expect.anything(),
    );
  });
});

// ---- ChunkEmbedProcessor：启动清理 + 失败置 FAILED ----

vi.mock('bullmq', () => ({
  Worker: class {
    close = vi.fn().mockResolvedValue(undefined);
  },
}));

function configStub() {
  return { get: (_k: string) => 'redis://localhost:6380' };
}

describe('ChunkEmbedProcessor', () => {
  it('onModuleInit 启动前把遗留 LEARNING 文档置 INTERRUPTED', async () => {
    const store = { markStuckLearningInterrupted: vi.fn().mockResolvedValue(2) };
    const p = new ChunkEmbedProcessor(
      configStub() as any,
      {} as any,
      store as any,
    );
    await p.onModuleInit();
    expect(store.markStuckLearningInterrupted).toHaveBeenCalledTimes(1);
    await p.onModuleDestroy();
  });

  it('清理失败仅告警不阻断 worker 启动', async () => {
    const store = {
      markStuckLearningInterrupted: vi.fn().mockRejectedValue(new Error('db down')),
    };
    const p = new ChunkEmbedProcessor(
      configStub() as any,
      {} as any,
      store as any,
    );
    await expect(p.onModuleInit()).resolves.not.toThrow();
    await p.onModuleDestroy();
  });

  it('process 失败：markFailed 后重抛（交由队列重试）', async () => {
    const learning = {
      learn: vi.fn().mockRejectedValue(new Error('解析失败')),
      markFailed: vi.fn().mockResolvedValue(undefined),
    };
    const p = new ChunkEmbedProcessor(
      configStub() as any,
      learning as any,
      { markStuckLearningInterrupted: vi.fn() } as any,
    );
    const job = { data: { tenantId: 't1', documentId: 'd1' }, attemptsMade: 0 } as any;
    await expect(p.process(job)).rejects.toThrow('解析失败');
    expect(learning.markFailed).toHaveBeenCalledWith('t1', 'd1', '解析失败');
  });

  it('process 成功：learn 返回切片数，不调用 markFailed', async () => {
    const learning = {
      learn: vi.fn().mockResolvedValue(7),
      markFailed: vi.fn(),
    };
    const p = new ChunkEmbedProcessor(
      configStub() as any,
      learning as any,
      { markStuckLearningInterrupted: vi.fn() } as any,
    );
    const job = { data: { tenantId: 't1', documentId: 'd1' }, attemptsMade: 0 } as any;
    await expect(p.process(job)).resolves.toBeUndefined();
    expect(learning.markFailed).not.toHaveBeenCalled();
  });
});
