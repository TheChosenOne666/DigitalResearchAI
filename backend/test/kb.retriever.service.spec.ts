import { describe, it, expect, vi } from 'vitest';
import { tenantAls } from '../src/common/auth/tenant-context';
import {
  KbRetrieverService,
  extractQueryTerms,
  toIlikePattern,
  localHitUrl,
} from '../src/modules/kb/retriever/kb.retriever.service';

/** 在租户上下文中执行 */
function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantAls.run({ userId: 'u1', tenantId: 't1', roles: ['USER'] }, fn);
}

describe('extractQueryTerms 分词', () => {
  it('ASCII 小写化取词，单字符过滤', () => {
    expect(extractQueryTerms('GDP 2024 a China')).toEqual(['gdp', '2024', 'china']);
  });

  it('中文滑窗切 bigram 并去重', () => {
    // 11 字连续汉字串：国内/内生/生产/产总/总值/值与/与生/生产(重复)/产效/效率 → 去重保序
    expect(extractQueryTerms('国内生产总值与生产效率')).toEqual([
      '国内',
      '内生',
      '生产',
      '产总',
      '总值',
      '值与',
      '与生',
      '产效',
      '效率',
    ]);
  });

  it('标点被剔除（ASCII 词先于中文 bigram）', () => {
    expect(extractQueryTerms('美国、GDP？')).toEqual(['gdp', '美国']);
  });

  it('超过 24 个截断', () => {
    const many = Array.from({ length: 30 }, (_, i) => `w${i}x`).join(' ');
    expect(extractQueryTerms(many)).toHaveLength(24);
  });
});

describe('toIlikePattern / localHitUrl', () => {
  it('ILIKE 通配符转义并包裹 %%', () => {
    expect(toIlikePattern('50%_a\\b')).toBe('%50\\%\\_a\\\\b%');
  });

  it('伪链接格式 kb://lib/doc/idx', () => {
    expect(localHitUrl('L1', 'D1', 3)).toBe('kb://L1/D1/3');
  });
});

/** 构造被测服务与依赖 mock */
function makeRetriever(opts?: {
  libs?: Array<{ id: string; topK: number; threshold: number; weight: number }>;
  embedEnabled?: boolean;
  embedReject?: boolean;
  qdrantHits?: Array<{ id: string; score: number; payload?: Record<string, unknown> }>;
  qdrantCollections?: string[];
  chunksByIds?: Array<Record<string, unknown>>;
  fulltextRows?: Array<{
    chunkId: string;
    libraryId: string;
    groupId: string | null;
    documentId: string;
    index: number;
    content: string;
    documentName: string;
    matchedTerms: number;
  }>;
}) {
  const store = {
    listLibraryRetrievalConfigs: vi.fn().mockResolvedValue(opts?.libs ?? []),
    getChunksWithDocNames: vi.fn().mockResolvedValue(opts?.chunksByIds ?? []),
    searchChunksFulltext: vi.fn().mockResolvedValue(opts?.fulltextRows ?? []),
  };
  const embed = {
    enabled: opts?.embedEnabled ?? false,
    embed: opts?.embedReject
      ? vi.fn().mockRejectedValue(new Error('embedding HTTP 500'))
      : vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
  };
  const qdrant = {
    isEnabled: vi.fn(() => true),
    collectionName: (t: string, l: string) => `tenant_${t}_lib_${l}`,
    listCollectionNames: vi.fn().mockResolvedValue(opts?.qdrantCollections ?? []),
    search: vi.fn().mockResolvedValue(opts?.qdrantHits ?? []),
  };
  const svc = new KbRetrieverService(store as any, embed as any, qdrant as any);
  return { svc, store, embed, qdrant };
}

describe('KbRetrieverService.search 混合检索', () => {
  it('缺少租户上下文抛未授权', async () => {
    const { svc } = makeRetriever();
    await expect(svc.search('任意问题')).rejects.toThrow(/租户上下文/);
  });

  it('无库或空问题返回空', async () => {
    const empty = makeRetriever();
    await expect(withTenant(() => empty.svc.search('国内生产总值'))).resolves.toEqual([]);

    const noQ = makeRetriever({
      libs: [{ id: 'lib1', topK: 10, threshold: 0.4, weight: 1.2 }],
    });
    await expect(withTenant(() => noQ.svc.search('   '))).resolves.toEqual([]);
  });

  it('无 Key 退化纯全文：rawScore=命中词占比，meta/url 映射正确', async () => {
    const { svc, store } = makeRetriever({
      libs: [{ id: 'lib1', topK: 10, threshold: 0.4, weight: 1.2 }],
      fulltextRows: [
        {
          chunkId: 'ck1',
          libraryId: 'lib1',
          groupId: null,
          documentId: 'd1',
          index: 0,
          content: '中国 GDP 数据'.repeat(20),
          documentName: '宏观指标.txt',
          matchedTerms: 2,
        },
      ],
    });
    const hits = await withTenant(() => svc.search('中国 GDP'));
    // 提取词 ['gdp','中国'] 共 2 个，命中词数 2 → 占比 1
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      title: '宏观指标.txt',
      sourceType: 'local',
      url: 'kb://lib1/d1/0',
      rawScore: 1,
      meta: { libraryId: 'lib1', groupId: null, documentId: 'd1', idx: 0 },
    });
    expect(hits[0].snippet.length).toBeLessThanOrEqual(160);
    expect(hits[0].contentMd).toContain('中国');
    expect(store.searchChunksFulltext).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1' }),
    );
  });

  it('多库全文命中按库权重排序（高权优先）', async () => {
    const row = (lib: string, doc: string, name: string) => ({
      chunkId: `ck_${doc}`,
      libraryId: lib,
      groupId: null,
      documentId: doc,
      index: 0,
      content: `${name} 内容`,
      documentName: name,
      matchedTerms: 2,
    });
    const { svc } = makeRetriever({
      libs: [
        { id: 'lowW', topK: 10, threshold: 0.4, weight: 0.5 },
        { id: 'highW', topK: 10, threshold: 0.4, weight: 2 },
      ],
      fulltextRows: [
        row('lowW', 'd_low', '低权重文档'),
        row('highW', 'd_high', '高权重文档'),
      ],
    });
    const hits = await withTenant(() => svc.search('知识 检索'));
    expect(hits.map((h) => h.title)).toEqual(['高权重文档', '低权重文档']);
  });

  it('向量路生效：阈值内命中与全文路融合，rawScore 取跨渠道最高', async () => {
    const { svc, store, embed, qdrant } = makeRetriever({
      libs: [{ id: 'lib1', topK: 10, threshold: 0.4, weight: 1.2 }],
      embedEnabled: true,
      qdrantCollections: ['tenant_t1_lib_lib1'],
      qdrantHits: [{ id: 'ck1', score: 0.85 }],
      chunksByIds: [
        {
          id: 'ck1',
          libraryId: 'lib1',
          groupId: null,
          documentId: 'd1',
          index: 0,
          content: '同一向量化切片内容',
          documentName: '同一文档',
        },
      ],
      fulltextRows: [
        {
          chunkId: 'ck1',
          libraryId: 'lib1',
          groupId: null,
          documentId: 'd1',
          index: 0,
          content: '同一向量化切片内容',
          documentName: '同一文档',
          matchedTerms: 1,
        },
      ],
    });
    const hits = await withTenant(() => svc.search('向量 测试'));// 提取词 4 个 bigram → 占比 1/4=0.25 < 向量 0.85
    expect(hits).toHaveLength(1);
    expect(hits[0].rawScore).toBe(0.85);
    expect(embed.embed).toHaveBeenCalledWith(['向量 测试'], undefined);
    expect(qdrant.search).toHaveBeenCalledWith('t1', 'lib1', [0.1, 0.2, 0.3], 10);
    expect(store.getChunksWithDocNames).toHaveBeenCalledWith('t1', ['ck1']);
  });

  it('向量低于库阈值被剔除（仅剩全文路得分）', async () => {
    const { svc, qdrant } = makeRetriever({
      libs: [{ id: 'lib1', topK: 10, threshold: 0.9, weight: 1.2 }],
      embedEnabled: true,
      qdrantCollections: ['tenant_t1_lib_lib1'],
      qdrantHits: [{ id: 'ck1', score: 0.7 }],
      chunksByIds: [],
      fulltextRows: [],
    });
    const hits = await withTenant(() => svc.search('知识 检索'));
    expect(qdrant.search).toHaveBeenCalled();
    expect(hits).toEqual([]);
  });

  it('问题向量化失败退纯全文不抛错', async () => {
    const { svc, store } = makeRetriever({
      libs: [{ id: 'lib1', topK: 10, threshold: 0.4, weight: 1.2 }],
      embedEnabled: true,
      embedReject: true,
      fulltextRows: [
        {
          chunkId: 'ck1',
          libraryId: 'lib1',
          groupId: null,
          documentId: 'd1',
          index: 0,
          content: '兜底内容',
          documentName: '兜底文档',
          matchedTerms: 1,
        },
      ],
    });
    const hits = await withTenant(() => svc.search('兜底 内容'));
    expect(hits).toHaveLength(1);
    expect(store.searchChunksFulltext).toHaveBeenCalledTimes(1);
  });
});
