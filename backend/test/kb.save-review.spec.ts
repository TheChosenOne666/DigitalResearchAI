import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tenantAls } from '../src/common/auth/tenant-context';
import { KbService } from '../src/modules/kb/kb.service';

/** 在租户上下文中执行 */
function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantAls.run({ userId: 'u1', tenantId: 't1', roles: ['USER'] }, fn);
}

/** 收集每个 Queue 实例的 add mock（vi.mock 工厂与测试体之间共享） */
const queueAdds = vi.hoisted(() => [] as Array<ReturnType<typeof vi.fn>>);

vi.mock('bullmq', () => ({
  Queue: class {
    /** 默认入队成功（返回带 id 的 job，submitLearnJob 据此判定提交成功） */
    add = vi.fn().mockResolvedValue({ id: `job-${queueAdds.length + 1}` });
    constructor() {
      queueAdds.push(this.add);
    }
  },
  Worker: class {},
}));

function makeService(opts?: {
  library?: Record<string, unknown>;
  groups?: Array<{ id: string; name: string }>;
  doc?: { status: string; mimeType?: string } | null;
  fileBytes?: Buffer | null;
}) {
  const store = {
    getLibrary: vi
      .fn()
      .mockResolvedValue(opts?.library === undefined ? { id: 'lib1', name: '宏观库' } : opts.library),
    listGroups: vi.fn().mockResolvedValue(opts?.groups ?? [{ id: 'g1', name: '宏观经济' }]),
    createDocument: vi.fn().mockImplementation((input: { name: string }) => ({ id: `kd_${input.name}` })),
    getDocument: vi
      .fn()
      .mockResolvedValue(
        opts?.doc === undefined ? { id: 'd1', status: 'PENDING', mimeType: 'md' } : opts.doc,
      ),
    getDocumentFile: vi.fn().mockResolvedValue(opts?.fileBytes ?? null),
    deleteDocument: vi.fn().mockResolvedValue(undefined),
    listPendingReviews: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  };
  const learning = { learn: vi.fn().mockResolvedValue(3), markFailed: vi.fn().mockResolvedValue(undefined) };
  const learningStore = { getDocumentFile: vi.fn().mockResolvedValue(opts?.fileBytes ?? null) };
  const config = { get: (_k: string) => 'redis://localhost:6380' };
  const svc = new KbService(store as any, learningStore as any, {} as any, learning as any, config as any);
  return { svc, store, learning };
}

const SRC = {
  idx: 0,
  title: '世界银行：美国 GDP',
  url: 'https://data.worldbank.org',
  snippet: '美国 GDP 数据…',
  sourceType: 'web',
};

describe('KbService.saveSourcesToLibrary（M3.4 入库）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('每条来源生成独立 md 文档落库（PENDING 待审核），带可见性/标签/会话', async () => {
    const { svc, store } = makeService();
    const r = await withTenant(() =>
      svc.saveSourcesToLibrary({
        libraryId: 'lib1',
        groupId: 'g1',
        visibility: 'PUBLIC',
        tags: ['GDP'],
        sessionId: 's1',
        question: '美国 GDP',
        sources: [SRC, { ...SRC, idx: 1, title: '垂直数据' }],
      }),
    );
    expect(r.created).toBe(2);
    expect(r.documents[0].name).toBe('世界银行：美国 GDP.md');
    expect(store.createDocument).toHaveBeenCalledTimes(2);
    const first = store.createDocument.mock.calls[0][0];
    expect(first).toMatchObject({
      tenantId: 't1',
      libraryId: 'lib1',
      groupId: 'g1',
      mimeType: 'md',
      visibility: 'PUBLIC',
      sourceSessionId: 's1',
    });
    expect(first.tags).toEqual(['GDP']);
    expect(Buffer.from(first.buffer as Uint8Array).toString('utf8')).toContain('# 世界银行：美国 GDP');
  });

  it('目标库不存在抛 404；分组不属于该库抛校验异常', async () => {
    const missingLib = makeService({ library: null });
    await expect(
      withTenant(() =>
        missingLib.svc.saveSourcesToLibrary({
          libraryId: 'nope', groupId: null, visibility: 'PRIVATE',
          tags: [], sessionId: 's1', sources: [SRC],
        }),
      ),
    ).rejects.toThrow(/目标知识库不存在/);

    const badGroup = makeService({ groups: [{ id: 'g9', name: '其它库分组' }] });
    await expect(
      withTenant(() =>
        badGroup.svc.saveSourcesToLibrary({
          libraryId: 'lib1', groupId: 'g1', visibility: 'PRIVATE',
          tags: [], sessionId: 's1', sources: [SRC],
        }),
      ),
    ).rejects.toThrow(/分组不存在/);
  });
});

describe('KbService.approveReview / rejectReview（M3.4 审核）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queueAdds.length = 0;
  });

  it('审核通过：入队触发学习（队列路），返回 LEARNING', async () => {
    const { svc, learning } = makeService({
      fileBytes: Buffer.from('# 存入文档'),
    });
    const r = await withTenant(() => svc.approveReview('d1'));
    expect(r).toEqual({ id: 'd1', status: 'LEARNING' });
    const lastAdd = queueAdds[queueAdds.length - 1];
    expect(lastAdd).toHaveBeenCalled();
    expect(learning.learn).not.toHaveBeenCalled();
  });

  it('队列入队失败降级同步学习，仍返回 LEARNING', async () => {
    const { svc, learning } = makeService({
      fileBytes: Buffer.from('# 存入文档'),
    });
    // 队列为懒初始化：先成功提交一次让 Queue 实例就位，再让下一次 add 拒绝
    await withTenant(() => svc.approveReview('d1'));
    const lastAdd = queueAdds[queueAdds.length - 1];
    lastAdd.mockRejectedValueOnce(new Error('redis down'));
    const r = await withTenant(() => svc.approveReview('d1'));
    expect(r).toEqual({ id: 'd1', status: 'LEARNING' });
    expect(learning.learn).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', documentId: 'd1', mimeType: 'md' }),
    );
  });

  it('文档缺失或非待审核状态抛错，不触发学习', async () => {
    const missing = makeService({ doc: null });
    await expect(withTenant(() => missing.svc.approveReview('d1'))).rejects.toThrow(/文档不存在/);

    const learned = makeService({ doc: { status: 'READY', mimeType: 'md' } });
    await expect(withTenant(() => learned.svc.approveReview('d1'))).rejects.toThrow(/待审核状态/);
    expect(learned.learning.learn).not.toHaveBeenCalled();
  });

  it('原件缺失：置 FAILED 并报「原始内容缺失」', async () => {
    const { svc, learning } = makeService({ fileBytes: null });
    await expect(withTenant(() => svc.approveReview('d1'))).rejects.toThrow(/原始内容缺失/);
    expect(learning.markFailed).toHaveBeenCalledWith('t1', 'd1', '原始内容缺失');
  });

  it('审核拒绝：仅允许 PENDING，删除文档行', async () => {
    const ok = makeService();
    const r = await withTenant(() => ok.svc.rejectReview('d1'));
    expect(r).toEqual({ id: 'd1', rejected: true });
    expect(ok.store.deleteDocument).toHaveBeenCalledWith('d1');

    const learned = makeService({ doc: { status: 'FAILED', mimeType: 'md' } });
    await expect(withTenant(() => learned.svc.rejectReview('d1'))).rejects.toThrow(/待审核状态/);
    expect(learned.store.deleteDocument).not.toHaveBeenCalled();
  });
});
