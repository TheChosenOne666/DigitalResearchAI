import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tenantAls } from '../src/common/auth/tenant-context';
import { SearchStoreService } from '../src/modules/search/persistence/search.store.service';
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
  };
  const usage = { upsert: vi.fn() };
  return {
    forTenant: { searchSession: session, searchUsage: usage },
    _session: session,
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
    const out = await svc.saveReport('s1', {
      contentMd: '正文',
      paramsSnapshot: { question: 'q' },
      tokenUsage: 5,
      sources: [
        { hit: hit('A', 'web', 'https://a'), idx: 0, isCited: true },
        { hit: hit('B', 'vertical'), idx: 1, isCited: false },
      ],
    });
    expect(out).toEqual({ id: 'r1' });
    const data = m._session.update.mock.calls[0][0];
    expect(data.where).toEqual({ id: 's1' });
    const create = data.data.reports.create;
    expect(create.contentMd).toBe('正文');
    expect(create.tokenUsage).toBe(5);
    expect(create.sources.create).toHaveLength(2);
    expect(create.sources.create[0]).toMatchObject({ idx: 0, isCited: true, url: 'https://a' });
    expect(create.sources.create[1]).toMatchObject({ idx: 1, isCited: false, url: null });
  });
});

describe('SearchStoreService.listSessions / reportDetail', () => {
  it('listSessions 映射最新报告', async () => {
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
    const svc = new SearchStoreService(m as any);
    const items = await svc.listSessions('u1', 1, 10);
    expect(items[0].reportId).toBe('r9');
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

describe('SearchStoreService.upsertUsage', () => {
  it('无租户上下文时跳过，不抛错', async () => {
    const m = mockPrisma();
    const svc = new SearchStoreService(m as any);
    await svc.upsertUsage('u1', 10);
    expect(m._usage.upsert).not.toHaveBeenCalled();
  });
});