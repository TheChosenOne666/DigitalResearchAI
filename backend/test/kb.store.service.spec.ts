import { describe, it, expect, vi } from 'vitest';
import { tenantAls } from '../src/common/auth/tenant-context';
import { KbStoreService } from '../src/modules/kb/store/kb.store.service';

/** 在租户上下文内执行（模拟受保护路由的拦截器注入） */
function withTenant<T>(fn: () => T | Promise<T>): Promise<T> {
  return tenantAls.run({ tenantId: 't1', userId: 'u1', roles: ['USER'] }, fn);
}

/** 构造 mock prisma：含 forTenant 下 kbLibrary/kbGroup/kbDocument */
function mockPrisma() {
  const kbLibrary = {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const kbGroup = {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const kbDocument = {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    delete: vi.fn(),
  };
  return {
    forTenant: { kbLibrary, kbGroup, kbDocument },
    _library: kbLibrary,
    _group: kbGroup,
    _document: kbDocument,
  };
}

function makeService(m: ReturnType<typeof mockPrisma>): KbStoreService {
  return new KbStoreService(m as any);
}

describe('KbStoreService 库', () => {
  it('createLibrary 写入库，tenantId 由上下文注入', async () => {
    const m = mockPrisma();
    m._library.create.mockResolvedValue({ id: 'lib1' });
    const out = await withTenant(() => makeService(m).createLibrary({ name: '宏观库' }));
    expect(out).toEqual({ id: 'lib1' });
    expect(m._library.create).toHaveBeenCalledWith({
      data: {
        tenantId: 't1',
        name: '宏观库',
        visibility: 'PRIVATE',
        color: '#16675f',
        description: null,
      },
    });
  });

  it('listLibraries 返回文档数与学习完成数', async () => {
    const m = mockPrisma();
    m._library.findMany.mockResolvedValue([
      {
        id: 'lib1',
        name: '宏观库',
        visibility: 'PRIVATE',
        color: '#16675f',
        description: null,
        topK: 10,
        threshold: 0.4,
        weight: 1.2,
        chunkMode: 'FIXED',
        chunkSize: 800,
        chunkOverlap: 80,
        embedModel: 'm',
        createdAt: new Date(),
        documents: [
          { id: 'd1', status: 'READY' },
          { id: 'd2', status: 'LEARNING' },
        ],
      },
    ]);
    const items = await makeService(m).listLibraries();
    expect(items).toHaveLength(1);
    expect(items[0].docCount).toBe(2);
    expect(items[0].readyCount).toBe(1);
  });

  it('updateLibrary 仅更新传入字段', async () => {
    const m = mockPrisma();
    m._library.findFirst.mockResolvedValue({ id: 'lib1' });
    m._library.update.mockResolvedValue({ id: 'lib1' });
    const out = await makeService(m).updateLibrary('lib1', { topK: 20 });
    expect(out).toEqual({ id: 'lib1' });
    const data = m._library.update.mock.calls[0][0].data;
    expect(data.topK).toBe(20);
    expect(data.name).toBeUndefined();
  });

  it('updateLibrary 跨租户库抛 404', async () => {
    const m = mockPrisma();
    m._library.findFirst.mockResolvedValue(null);
    await expect(makeService(m).updateLibrary('nope', { topK: 1 })).rejects.toMatchObject({
      bizCode: 4001,
    });
  });

  it('deleteLibrary 正常删除', async () => {
    const m = mockPrisma();
    m._library.findFirst.mockResolvedValue({ id: 'lib1' });
    m._library.delete.mockResolvedValue({ id: 'lib1' });
    await makeService(m).deleteLibrary('lib1');
    expect(m._library.delete).toHaveBeenCalledWith({ where: { id: 'lib1' } });
  });
});

describe('KbStoreService 分组', () => {
  it('createGroup 写入分组并注入 tenantId', async () => {
    const m = mockPrisma();
    m._library.findFirst.mockResolvedValue({ id: 'lib1' });
    m._group.create.mockResolvedValue({ id: 'g1' });
    const out = await withTenant(() => makeService(m).createGroup('lib1', { name: 'GDP 组' }));
    expect(out).toEqual({ id: 'g1' });
    expect(m._group.create).toHaveBeenCalledWith({
      data: { tenantId: 't1', libraryId: 'lib1', name: 'GDP 组' },
    });
  });

  it('listGroups 返回文档数', async () => {
    const m = mockPrisma();
    m._library.findFirst.mockResolvedValue({ id: 'lib1' });
    m._group.findMany.mockResolvedValue([
      { id: 'g1', name: 'G', createdAt: new Date(), documents: [{ id: 'd1' }, { id: 'd2' }] },
    ]);
    const items = await makeService(m).listGroups('lib1');
    expect(items[0].docCount).toBe(2);
  });
});

describe('KbStoreService 文档', () => {
  it('listDocuments 分页 + 筛选 + 总条数', async () => {
    const m = mockPrisma();
    m._library.findFirst.mockResolvedValue({ id: 'lib1' });
    m._document.findMany.mockResolvedValue([
      {
        id: 'd1',
        groupId: null,
        libraryId: 'lib1',
        name: 'a.xlsx',
        mimeType: 'xlsx',
        size: 100,
        status: 'READY',
        failReason: null,
        chunkCount: 3,
        createdAt: new Date(),
      },
    ]);
    m._document.count.mockResolvedValue(1);
    const out = await makeService(m).listDocuments('lib1', { status: 'READY' }, 1, 10);
    expect(out.total).toBe(1);
    expect(out.items[0].name).toBe('a.xlsx');
    expect(m._document.findMany).toHaveBeenCalled();
  });

  it('getDocument 返回详情与切片', async () => {
    const m = mockPrisma();
    m._document.findFirst.mockResolvedValue({
      id: 'd1',
      groupId: null,
      libraryId: 'lib1',
      name: 'a',
      mimeType: 'xlsx',
      size: 1,
      status: 'READY',
      failReason: null,
      chunkCount: 1,
      createdAt: new Date(),
      chunks: [{ id: 'c1', index: 0, content: '内容', vectorId: 'v1' }],
    });
    const doc = await makeService(m).getDocument('d1');
    expect(doc?.chunks).toHaveLength(1);
    expect(doc?.chunks[0].vectorId).toBe('v1');
  });

  it('deleteDocument 跨租户抛 404（先查后删）', async () => {
    const m = mockPrisma();
    m._document.findFirst.mockResolvedValue(null);
    await expect(makeService(m).deleteDocument('nope')).rejects.toMatchObject({ bizCode: 4001 });
  });
});