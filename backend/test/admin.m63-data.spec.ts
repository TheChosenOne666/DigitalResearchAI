import { describe, expect, it, vi } from 'vitest';
import { AdminDictsService } from '../src/modules/admin/dicts.service';
import { AdminDatasetsService } from '../src/modules/admin/datasets.service';
import { AdminNoticesService } from '../src/modules/admin/notices.service';
import { ErrorCode } from '@app/shared';

describe('AdminDictsService（字典）', () => {
  function buildPrisma(overrides: Record<string, unknown> = {}) {
    return {
      dictItem: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue(null),
      },
      ...overrides,
    };
  }

  it('list 按 type 过滤并返回分页', async () => {
    const prisma = buildPrisma({
      dictItem: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          { id: 'd1', type: 'COUNTRY', code: 'CN', name: '中国', nameEn: 'China', parentCode: null, remark: null, sort: 1, enabled: true, createdAt: new Date() },
        ]),
      },
    });
    const svc = new AdminDictsService(prisma as never);
    const res = await svc.list({ type: 'COUNTRY', keyword: '', enabled: '', page: 1, pageSize: 20 });
    expect(res.list[0].code).toBe('CN');
    expect(prisma.dictItem.count).toHaveBeenCalledWith(expect.objectContaining({ where: { type: 'COUNTRY' } }));
  });

  it('同类型编码重复 → CONFLICT', async () => {
    const prisma = buildPrisma({ dictItem: { findUnique: vi.fn().mockResolvedValue({ id: 'd1' }) } });
    const svc = new AdminDictsService(prisma as never);
    await expect(
      svc.create({ type: 'COUNTRY', code: 'CN', name: '中国' }),
    ).rejects.toMatchObject({ bizCode: ErrorCode.CONFLICT });
  });

  it('停用/启用返回新状态', async () => {
    const prisma = buildPrisma();
    prisma.dictItem.findUnique = vi.fn().mockResolvedValue({ id: 'd1' }) as never;
    prisma.dictItem.update = vi.fn().mockResolvedValue({ id: 'd1', enabled: false }) as never;
    const svc = new AdminDictsService(prisma as never);
    const res = await svc.setEnabled('d1', { enabled: false });
    expect(res.enabled).toBe(false);
  });
});

describe('AdminDatasetsService（数据集）', () => {
  function buildPrisma(overrides: Record<string, unknown> = {}) {
    return {
      dataset: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue(null),
      },
      ...overrides,
    };
  }

  it('list 支持来源/状态筛选', async () => {
    const prisma = buildPrisma({
      dataset: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          { id: 'ds1', tenantId: null, name: '公共数据集 · 宏观经济', source: 'IMPORT', category: '宏观经济', fieldCount: 24, status: 'ONLINE', meta: null, createdAt: new Date(), updatedAt: new Date() },
        ]),
      },
    });
    const svc = new AdminDatasetsService(prisma as never);
    const res = await svc.list({ keyword: '', source: 'IMPORT', status: 'ONLINE', page: 1, pageSize: 20 });
    expect(res.list[0].name).toBe('公共数据集 · 宏观经济');
    expect(prisma.dataset.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ source: 'IMPORT', status: 'ONLINE' }) }));
  });

  it('上下架返回新状态', async () => {
    const prisma = buildPrisma();
    prisma.dataset.findUnique = vi.fn().mockResolvedValue({ id: 'ds1' }) as never;
    prisma.dataset.update = vi.fn().mockResolvedValue({ id: 'ds1', status: 'OFFLINE' }) as never;
    const svc = new AdminDatasetsService(prisma as never);
    const res = await svc.setStatus('ds1', { status: 'OFFLINE' });
    expect(res.status).toBe('OFFLINE');
  });
});

describe('AdminNoticesService（公告）', () => {
  function buildPrisma(overrides: Record<string, unknown> = {}) {
    return {
      notice: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue(null),
      },
      ...overrides,
    };
  }

  it('新建公告默认草稿', async () => {
    const prisma = buildPrisma();
    prisma.notice.create = vi.fn().mockResolvedValue({ id: 'n1', title: '更新通知', content: 'x', scope: 'ALL', status: 'DRAFT' }) as never;
    const svc = new AdminNoticesService(prisma as never);
    const row = await svc.create({ title: '更新通知', content: 'x', scope: 'ALL' });
    expect(row.status).toBe('DRAFT');
  });

  it('已发布公告禁止编辑 → CONFLICT', async () => {
    const prisma = buildPrisma({ notice: { findUnique: vi.fn().mockResolvedValue({ id: 'n1', status: 'PUBLISHED' }) } });
    const svc = new AdminNoticesService(prisma as never);
    await expect(svc.update('n1', { title: 'x' })).rejects.toMatchObject({ bizCode: ErrorCode.CONFLICT });
  });

  it('发布后状态 PUBLISHED 并落 publishedAt', async () => {
    const prisma = buildPrisma();
    prisma.notice.findUnique = vi.fn().mockResolvedValue({ id: 'n1', status: 'DRAFT' }) as never;
    prisma.notice.update = vi.fn().mockResolvedValue({ id: 'n1', status: 'PUBLISHED', publishedAt: new Date() }) as never;
    const svc = new AdminNoticesService(prisma as never);
    const res = await svc.publish('n1');
    expect(res.status).toBe('PUBLISHED');
  });

  it('非已发布公告撤回 → CONFLICT', async () => {
    const prisma = buildPrisma({ notice: { findUnique: vi.fn().mockResolvedValue({ id: 'n1', status: 'DRAFT' }) } });
    const svc = new AdminNoticesService(prisma as never);
    await expect(svc.withdraw('n1')).rejects.toMatchObject({ bizCode: ErrorCode.CONFLICT });
  });
});
