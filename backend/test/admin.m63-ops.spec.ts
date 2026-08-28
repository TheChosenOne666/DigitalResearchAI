import { describe, expect, it, vi } from 'vitest';
import { AdminImportsService, isOverdue, countWorkdays } from '../src/modules/admin/imports.service';
import { AdminSearchOpsService } from '../src/modules/admin/search-ops.service';
import { tenantAls } from '../src/common/auth/tenant-context';
import { ErrorCode } from '@app/shared';

describe('countWorkdays / isOverdue（超 3 工作日高亮）', () => {
  it('工作日计数跳过周末', () => {
    // 周五 2026-08-28 → 周一 2026-08-31，跨一个周末
    const fri = new Date(2026, 7, 28);
    const mon = new Date(2026, 7, 31);
    expect(countWorkdays(fri, mon)).toBe(2); // 周五 + 周一
  });

  it('超过 3 个工作日判定 overdue', () => {
    const from = new Date(2026, 7, 24); // 周一
    const to = new Date(2026, 7, 28); // 周五，5 个工作日
    expect(isOverdue(from, to)).toBe(true);
  });

  it('3 个工作日以内不 overdue', () => {
    const from = new Date(2026, 7, 26); // 周三
    const to = new Date(2026, 7, 28); // 周五，3 个工作日
    expect(isOverdue(from, to)).toBe(false);
  });
});

describe('AdminImportsService（数据接入审核）', () => {
  function buildPrisma(overrides: Record<string, unknown> = {}) {
    const tx = {
      importTask: { update: vi.fn().mockResolvedValue({ id: 't1' }) },
      dataset: { create: vi.fn().mockResolvedValue({ id: 'ds1' }) },
      message: { create: vi.fn().mockResolvedValue({ id: 'm1' }) },
    };
    const prisma = {
      importTask: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      user: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      ...overrides,
    };
    return { prisma, tx };
  }

  it('list 组装提交人展示名 + 超期标记', async () => {
    const { prisma } = buildPrisma({
      importTask: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          { id: 't1', name: '2025年宏观数据', type: 'EXCEL', sizeBytes: 2516582, submitterId: 'u1', status: 'PENDING', rejectReason: null, createdAt: new Date(Date.now() - 10 * 86400000), reviewedAt: null },
        ]),
      },
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'u1', username: 'li_research', nickname: '李研究', phone: '138' }]) },
    });
    const svc = new AdminImportsService(prisma as never);
    const res = await svc.list({ status: 'PENDING', type: '', page: 1, pageSize: 20 });
    expect(res.list[0].submitter).toBe('li_research');
    expect(res.list[0].overdue).toBe(true);
  });

  it('approve 通过 → 写 dataset + IMPORT 通知', async () => {
    const { prisma, tx } = buildPrisma();
    prisma.importTask.findUnique = vi.fn().mockResolvedValue({
      id: 't1',
      tenantId: 'ten1',
      name: '2025年宏观数据',
      submitterId: 'u1',
      status: 'PENDING',
      preview: { headers: ['年份', '国家', 'GDP'], rows: [] },
    }) as never;
    const svc = new AdminImportsService(prisma as never);
    const res = await tenantAls.run({ userId: 'op1', tenantId: 'ten1', roles: ['PLATFORM_ADMIN'] }, () => svc.approve('t1'));
    expect(res.status).toBe('APPROVED');
    expect(tx.dataset.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ source: 'IMPORT', fieldCount: 3 }),
    }));
    expect(tx.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'IMPORT', userId: 'u1' }),
    }));
  });

  it('重复审核 → CONFLICT', async () => {
    const { prisma } = buildPrisma();
    prisma.importTask.findUnique = vi.fn().mockResolvedValue({ id: 't1', status: 'APPROVED' }) as never;
    const svc = new AdminImportsService(prisma as never);
    await expect(svc.approve('t1')).rejects.toMatchObject({ bizCode: ErrorCode.CONFLICT });
  });

  it('reject 退回 → 状态 REJECTED + 通知', async () => {
    const { prisma, tx } = buildPrisma();
    prisma.importTask.findUnique = vi.fn().mockResolvedValue({
      id: 't1', tenantId: 'ten1', name: 'x', submitterId: 'u1', status: 'PENDING',
    }) as never;
    const svc = new AdminImportsService(prisma as never);
    const res = await tenantAls.run({ userId: 'op1', tenantId: 'ten1', roles: ['PLATFORM_ADMIN'] }, () =>
      svc.reject('t1', { reason: '数据格式不规范' }),
    );
    expect(res.status).toBe('REJECTED');
    expect(tx.importTask.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ rejectReason: '数据格式不规范' }),
    }));
  });
});

describe('AdminSearchOpsService（搜索运营）', () => {
  function buildPrisma(overrides: Record<string, unknown> = {}) {
    return {
      searchTerm: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue(null),
      },
      sensitiveWord: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue(null),
      },
      ...overrides,
    };
  }

  it('listTerms hot 按 totalCount 降序', async () => {
    const prisma = buildPrisma({
      searchTerm: {
        count: vi.fn().mockResolvedValue(2),
        findMany: vi.fn().mockResolvedValue([
          { id: 's1', term: '中国GDP', totalCount: 100, emptyCount: 0, lastSearchedAt: new Date(), isQuick: false, isSuggest: false, createdAt: new Date(), updatedAt: new Date() },
        ]),
      },
    });
    const svc = new AdminSearchOpsService(prisma as never);
    const res = await svc.listTerms('hot', 1, 20);
    expect(res.list[0].term).toBe('中国GDP');
  });

  it('listTerms empty 过滤 emptyCount>0', async () => {
    const prisma = buildPrisma();
    const svc = new AdminSearchOpsService(prisma as never);
    await svc.listTerms('empty', 1, 20);
    expect(prisma.searchTerm.count).toHaveBeenCalledWith({ where: { emptyCount: { gt: 0 } } });
  });

  it('setTermFlags 更新快捷检索/搜索建议', async () => {
    const prisma = buildPrisma();
    prisma.searchTerm.findUnique = vi.fn().mockResolvedValue({ id: 's1', term: '中国GDP' }) as never;
    prisma.searchTerm.update = vi.fn().mockResolvedValue({ id: 's1', term: '中国GDP', isQuick: true, isSuggest: false }) as never;
    const svc = new AdminSearchOpsService(prisma as never);
    const row = await svc.setTermFlags('s1', { isQuick: true });
    expect(row.isQuick).toBe(true);
  });

  it('敏感词重复 → CONFLICT', async () => {
    const prisma = buildPrisma({ sensitiveWord: { findFirst: vi.fn().mockResolvedValue({ id: 'w1' }) } });
    const svc = new AdminSearchOpsService(prisma as never);
    await expect(svc.createSensitive({ word: '词A', type: 'POLITICS' })).rejects.toMatchObject({ bizCode: ErrorCode.CONFLICT });
  });

  it('新增敏感词返回行', async () => {
    const prisma = buildPrisma();
    prisma.sensitiveWord.create = vi.fn().mockResolvedValue({ id: 'w1', word: '词A', type: 'POLITICS', hitCount: 0, enabled: true }) as never;
    const svc = new AdminSearchOpsService(prisma as never);
    const row = await svc.createSensitive({ word: '词A', type: 'POLITICS' });
    expect(row.word).toBe('词A');
  });
});
