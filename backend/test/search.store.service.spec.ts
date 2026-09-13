import { describe, it, expect, vi } from 'vitest';
import { tenantAls } from '../src/common/auth/tenant-context';
import { SearchStoreService } from '../src/modules/search/persistence/search.store.service';
import { RETRIEVAL_TTL_SECONDS } from '../src/modules/search/search.constants';
import type { SearchHit } from '../src/modules/search/connectors/connector.interface';

/** 在租户上下文内执行（模拟受保护路由的拦截器注入） */
function withTenant<T>(fn: () => T | Promise<T>): Promise<T> {
  return tenantAls.run({ tenantId: 't1', userId: 'u1', roles: ['USER'] }, fn);
}

function mockPrisma() {
  const session = {
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    deleteMany: vi.fn(),
  };
  const retrieval = {
    upsert: vi.fn(),
    findFirst: vi.fn(),
    // 默认无过期行（saveRetrieval 每次会顺手清理）
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  const usage = { upsert: vi.fn() };
  return {
    forTenant: { searchSession: session, searchRetrieval: retrieval, searchUsage: usage },
    _session: session,
    _retrieval: retrieval,
    _usage: usage,
  };
}

const hit = (title: string, sourceType: SearchHit['sourceType'], url?: string): SearchHit => ({
  title,
  snippet: 's',
  url,
  contentMd: 'md',
  sourceType,
});

describe('SearchStoreService.createSession', () => {
  it('写入会话并按需要返回 id', async () => {
    const m = mockPrisma();
    m._session.create.mockResolvedValue({ id: 's1' });
    const svc = new SearchStoreService(m as any);
    const out = await withTenant(() =>
      svc.createSession('u1', '美国 GDP', 'hybrid', { indicators: ['GDP'] }),
    );
    expect(out).toEqual({ id: 's1' });
    expect(m._session.create).toHaveBeenCalledWith({
      data: {
        tenantId: 't1',
        userId: 'u1',
        question: '美国 GDP',
        mode: 'hybrid',
        conditions: { indicators: ['GDP'] },
      },
    });
  });
});

describe('SearchStoreService.saveReport', () => {
  it('嵌套写入来源并返回最新报告 id', async () => {
    const m = mockPrisma();
    m._session.update.mockResolvedValue({
      reports: [{ id: 'r1', createdAt: new Date() }],
    });
    const svc = new SearchStoreService(m as any);
    // 嵌套写需显式带 tenantId（租户扩展不处理嵌套 create），故此处需租户上下文
    const out = await withTenant(() =>
      svc.saveReport('s1', {
        contentMd: '正文',
        paramsSnapshot: { question: 'q' },
        tokenUsage: 5,
        sources: [
          { hit: hit('A', 'web', 'https://a'), idx: 0, isCited: true },
          { hit: hit('B', 'vertical'), idx: 1, isCited: false },
        ],
      }),
    );
    expect(out).toEqual({ id: 'r1' });
    const data = m._session.update.mock.calls[0][0];
    expect(data.where).toEqual({ id: 's1' });
    const create = data.data.reports.create;
    expect(create.contentMd).toBe('正文');
    expect(create.tokenUsage).toBe(5);
    // 报告与其来源都必须显式带上 tenantId
    expect(create.tenantId).toBe('t1');
    expect(create.sources.create).toHaveLength(2);
    expect(create.sources.create[0]).toMatchObject({
      tenantId: 't1',
      idx: 0,
      isCited: true,
      url: 'https://a',
    });
    expect(create.sources.create[1]).toMatchObject({ idx: 1, isCited: false, url: null });
  });
});

describe('SearchStoreService.listSessions / reportDetail', () => {
  it('listSessions 映射最新报告并返回真实总数', async () => {
    const m = mockPrisma();
    m._session.findMany.mockResolvedValue([
      {
        id: 's1',
        question: 'q',
        mode: 'hybrid',
        conditions: null,
        createdAt: new Date(),
        reports: [{ id: 'r9', createdAt: new Date() }],
      },
    ]);
    m._session.count.mockResolvedValue(25);
    const svc = new SearchStoreService(m as any);
    const { items, total } = await svc.listSessions('u1', 1, 10);
    expect(items[0].reportId).toBe('r9');
    expect(total).toBe(25);
    expect(m._session.count).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(m._session.findMany).toHaveBeenCalled();
  });

  it('reportDetail 不存在时抛 404 业务异常', async () => {
    const m = mockPrisma();
    m._session.findFirst.mockResolvedValue(null);
    const svc = new SearchStoreService(m as any);
    await expect(svc.reportDetail('nope')).rejects.toMatchObject({ bizCode: 4001 });
  });

  it('reportDetail 返回报告与来源（按 idx 升序）', async () => {
    const m = mockPrisma();
    m._session.findFirst.mockResolvedValue({
      id: 's1',
      reports: [
        {
          id: 'r1',
          contentMd: '正文',
          paramsSnapshot: null,
          tokenUsage: 0,
          createdAt: new Date(),
          sources: [{ idx: 0, title: 'A', url: null, snippet: 's', sourceType: 'web', isCited: true, meta: null }],
        },
      ],
    });
    const svc = new SearchStoreService(m as any);
    const r = await svc.reportDetail('s1');
    expect(r.id).toBe('r1');
    expect(r.sources[0].title).toBe('A');
    expect(r.sources[0].isCited).toBe(true);
  });
});

describe('SearchStoreService.saveRetrieval / getRetrieval', () => {
  it('saveRetrieval 按会话 upsert（重复检索覆盖旧快照）', async () => {
    const m = mockPrisma();
    const svc = new SearchStoreService(m as any);
    const sources = [
      { idx: 1, title: 'A', url: 'https://a', snippet: 's', contentMd: 'md', sourceType: 'web', isCited: true },
    ];
    await withTenant(() => svc.saveRetrieval('s1', '重写问题', 'hybrid', sources));
    const arg = m._retrieval.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ sessionId: 's1' });
    expect(arg.create.question).toBe('重写问题');
    expect(arg.create.sources).toEqual(sources);
    expect(arg.update.question).toBe('重写问题');
  });

  it('getRetrieval 返回快照与原始问题（session 关联取 question）', async () => {
    const m = mockPrisma();
    const createdAt = new Date();
    m._retrieval.findFirst.mockResolvedValue({
      sessionId: 's1',
      question: '重写问题',
      mode: 'hybrid',
      sources: [{ idx: 1, title: 'A' }],
      createdAt,
      session: { question: '原始问题' },
    });
    const svc = new SearchStoreService(m as any);
    const r = await withTenant(() => svc.getRetrieval('s1'));
    expect(r).toEqual({ question: '原始问题', mode: 'hybrid', sources: [{ idx: 1, title: 'A' }], createdAt });
    expect(m._retrieval.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sessionId: 's1' } }),
    );
  });

  it('getRetrieval 不存在/跨租户返回 null', async () => {
    const m = mockPrisma();
    m._retrieval.findFirst.mockResolvedValue(null);
    const svc = new SearchStoreService(m as any);
    await expect(withTenant(() => svc.getRetrieval('nope'))).resolves.toBeNull();
  });

  it('saveRetrieval 顺手清理本租户过期快照（按 TTL 截止时间 + 显式 tenantId）', async () => {
    const m = mockPrisma();
    m._retrieval.deleteMany.mockResolvedValue({ count: 3 });
    const svc = new SearchStoreService(m as any);
    const before = Date.now();
    await withTenant(() => svc.saveRetrieval('s1', 'q', 'hybrid', []));

    const purgeArg = m._retrieval.deleteMany.mock.calls[0][0];
    expect(purgeArg.where.tenantId).toBe('t1');
    // 截止时间 ≈ now - TTL
    const deadline: Date = purgeArg.where.createdAt.lt;
    const expected = before - RETRIEVAL_TTL_SECONDS * 1000;
    expect(Math.abs(deadline.getTime() - expected)).toBeLessThan(5000);
    // 清理先于写快照（避免刚写入的快照被误判）
    expect(m._retrieval.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      m._retrieval.upsert.mock.invocationCallOrder[0],
    );
  });

  it('saveRetrieval 写入 create 显式带 tenantId（upsert 的 create 分支）', async () => {
    const m = mockPrisma();
    const svc = new SearchStoreService(m as any);
    await withTenant(() => svc.saveRetrieval('s1', 'q', 'hybrid', []));
    expect(m._retrieval.upsert.mock.calls[0][0].create.tenantId).toBe('t1');
  });
});

describe('SearchStoreService.clearSessions', () => {
  it('删除当前用户全部会话并返回删除数', async () => {
    const m = mockPrisma();
    m._session.deleteMany.mockResolvedValue({ count: 3 });
    const svc = new SearchStoreService(m as any);
    const out = await withTenant(() => svc.clearSessions('u1'));
    expect(out).toEqual({ deleted: 3 });
    expect(m._session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  it('无租户上下文时抛 401 业务异常，不执行删除', async () => {
    const m = mockPrisma();
    const svc = new SearchStoreService(m as any);
    await expect(svc.clearSessions('u1')).rejects.toMatchObject({ bizCode: 1001 });
    expect(m._session.deleteMany).not.toHaveBeenCalled();
  });
});

describe('SearchStoreService.upsertUsage', () => {
  it('无租户上下文时跳过，不抛错', async () => {
    const m = mockPrisma();
    const svc = new SearchStoreService(m as any);
    await svc.upsertUsage('u1', 10);
    expect(m._usage.upsert).not.toHaveBeenCalled();
  });
});