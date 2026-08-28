import { describe, it, expect, vi } from 'vitest';
import { tenantAls } from '../src/common/auth/tenant-context';
import { WorkspaceStoreService } from '../src/modules/workspace/workspace.store.service';
import { BizException } from '../src/common/exceptions/biz.exception';

/** 在租户上下文内执行 */
function withTenant<T>(fn: () => T | Promise<T>): Promise<T> {
  return tenantAls.run({ tenantId: 't1', userId: 'u1', roles: ['USER'] }, fn);
}

function mockPrisma() {
  const report = {
    create: vi.fn(),
    findFirst: vi.fn(),
  };
  return { forTenant: { workspaceReport: report }, _report: report };
}

describe('WorkspaceStoreService.saveReport', () => {
  it('写入报告并返回 id', async () => {
    const m = mockPrisma();
    m._report.create.mockResolvedValue({ id: 'r1' });
    const svc = new WorkspaceStoreService(m as any);
    const out = await withTenant(() =>
      svc.saveReport('u1', {
        title: 'GDP 数据分析报告',
        contentMd: '## 正文',
        paramsSnapshot: { stats: {} },
        sources: [],
        tokenUsage: 10,
      }),
    );
    expect(out).toEqual({ id: 'r1' });
    expect(m._report.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 't1',
        userId: 'u1',
        title: 'GDP 数据分析报告',
        tokenUsage: 10,
      }),
    });
  });
});

describe('WorkspaceStoreService.reportDetail', () => {
  it('不存在时抛 404 业务异常', async () => {
    const m = mockPrisma();
    m._report.findFirst.mockResolvedValue(null);
    const svc = new WorkspaceStoreService(m as any);
    await expect(withTenant(() => svc.reportDetail('missing'))).rejects.toThrow(BizException);
  });

  it('存在时返回报告详情字段', async () => {
    const m = mockPrisma();
    m._report.findFirst.mockResolvedValue({
      id: 'r1',
      title: 'GDP 数据分析报告',
      contentMd: '正文',
      paramsSnapshot: { stats: {} },
      sources: [],
      tokenUsage: 5,
      status: 'DRAFT',
      version: 1,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    });
    const svc = new WorkspaceStoreService(m as any);
    const detail = await withTenant(() => svc.reportDetail('r1'));
    expect(detail.id).toBe('r1');
    expect(detail.title).toBe('GDP 数据分析报告');
    expect(detail.status).toBe('DRAFT');
  });
});

/* ===== M4.4 我的数据 / 我的报告 ===== */

function mockDatasetPrisma() {
  const dataset = {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const report = { findMany: vi.fn(), findFirst: vi.fn() };
  const session = { findMany: vi.fn(), findFirst: vi.fn() };
  return { forTenant: { workspaceDataset: dataset, workspaceReport: report, searchSession: session } };
}

describe('WorkspaceStoreService.saveDataset', () => {
  it('写入数据集并返回 id', async () => {
    const m = mockDatasetPrisma();
    m.forTenant.workspaceDataset.create.mockResolvedValue({ id: 'ds1' });
    const svc = new WorkspaceStoreService(m as any);
    const out = await withTenant(() =>
      svc.saveDataset({ name: 'GDP 快照', data: { series: [] }, tags: ['GDP'], sourceType: 'WDI' }),
    );
    expect(out).toEqual({ id: 'ds1' });
    expect(m.forTenant.workspaceDataset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: 't1', userId: 'u1', name: 'GDP 快照' }),
    });
  });
});

describe('WorkspaceStoreService.listDatasets', () => {
  const rows = [
    { id: 'd1', name: 'GDP 增长率', data: {}, tags: ['GDP'], status: 'ACTIVE', sourceType: 'WDI', createdAt: new Date(), updatedAt: new Date() },
    { id: 'd2', name: '进出口数据', data: {}, tags: ['进出口'], status: 'ARCHIVED', sourceType: 'upload', createdAt: new Date(), updatedAt: new Date() },
    { id: 'd3', name: 'GDP 快照', data: {}, tags: ['GDP', '快照'], status: 'ACTIVE', sourceType: 'mixed', createdAt: new Date(), updatedAt: new Date() },
  ];

  it('keyword + tag 内存过滤，分页生效', async () => {
    const m = mockDatasetPrisma();
    m.forTenant.workspaceDataset.findMany.mockResolvedValue(rows);
    const svc = new WorkspaceStoreService(m as any);
    const out = await withTenant(() => svc.listDatasets({ keyword: '', tag: 'GDP', status: 'ACTIVE', page: 1, pageSize: 2 }));
    expect(out.total).toBe(2);
    expect(out.list.map((x) => x.id)).toEqual(['d1', 'd3']);
  });

  it('keyword 命中标签', async () => {
    const m = mockDatasetPrisma();
    m.forTenant.workspaceDataset.findMany.mockResolvedValue(rows);
    const svc = new WorkspaceStoreService(m as any);
    const out = await withTenant(() => svc.listDatasets({ keyword: '进出口', page: 1, pageSize: 10 }));
    expect(out.total).toBe(1);
    expect(out.list[0].id).toBe('d2');
  });

  it('分页跳页正确切片', async () => {
    const m = mockDatasetPrisma();
    m.forTenant.workspaceDataset.findMany.mockResolvedValue(rows);
    const svc = new WorkspaceStoreService(m as any);
    const out = await withTenant(() => svc.listDatasets({ page: 2, pageSize: 2 }));
    expect(out.total).toBe(3);
    expect(out.list.map((x) => x.id)).toEqual(['d3']);
  });
});

describe('WorkspaceStoreService.archiveDataset', () => {
  it('ACTIVE → ARCHIVED → ACTIVE 幂等切换', async () => {
    const m = mockDatasetPrisma();
    m.forTenant.workspaceDataset.findFirst.mockResolvedValueOnce({ id: 'd1', status: 'ACTIVE' });
    const svc = new WorkspaceStoreService(m as any);
    const out1 = await withTenant(() => svc.archiveDataset('d1'));
    expect(out1).toEqual({ status: 'ARCHIVED' });
    expect(m.forTenant.workspaceDataset.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { status: 'ARCHIVED' } });

    m.forTenant.workspaceDataset.findFirst.mockResolvedValueOnce({ id: 'd1', status: 'ARCHIVED' });
    const out2 = await withTenant(() => svc.archiveDataset('d1'));
    expect(out2).toEqual({ status: 'ACTIVE' });
  });

  it('不存在时抛 404', async () => {
    const m = mockDatasetPrisma();
    m.forTenant.workspaceDataset.findFirst.mockResolvedValue(null);
    const svc = new WorkspaceStoreService(m as any);
    await expect(withTenant(() => svc.archiveDataset('missing'))).rejects.toThrow(BizException);
  });
});

describe('WorkspaceStoreService.deleteDataset', () => {
  it('存在时删除并返回 deleted=true', async () => {
    const m = mockDatasetPrisma();
    m.forTenant.workspaceDataset.findFirst.mockResolvedValue({ id: 'd1', status: 'ACTIVE' });
    const svc = new WorkspaceStoreService(m as any);
    const out = await withTenant(() => svc.deleteDataset('d1'));
    expect(out).toEqual({ deleted: true });
    expect(m.forTenant.workspaceDataset.delete).toHaveBeenCalledWith({ where: { id: 'd1' } });
  });

  it('跨租户/不存在 → 404（findFirst 过滤租户）', async () => {
    const m = mockDatasetPrisma();
    m.forTenant.workspaceDataset.findFirst.mockResolvedValue(null);
    const svc = new WorkspaceStoreService(m as any);
    await expect(withTenant(() => svc.deleteDataset('missing'))).rejects.toThrow(BizException);
    expect(m.forTenant.workspaceDataset.delete).not.toHaveBeenCalled();
  });
});

describe('WorkspaceStoreService.listReports（聚合）', () => {
  it('两类报告内存合并按 updatedAt 降序 + 分页', async () => {
    const m = mockDatasetPrisma();
    m.forTenant.searchSession.findMany.mockResolvedValue([
      {
        id: 's1',
        question: 'GDP 对比',
        // include 指定 orderBy createdAt desc：模拟 DB 已按时间倒序返回（最新在前）
        reports: [
          { id: 'r2', createdAt: new Date('2026-08-27T10:00:00Z') },
          { id: 'r1', createdAt: new Date('2026-08-20T10:00:00Z') },
        ],
      },
    ]);
    m.forTenant.workspaceReport.findMany.mockResolvedValue([
      { id: 'w1', title: '分析报告 A', version: 1, status: 'DRAFT', createdAt: new Date('2026-08-25T10:00:00Z') },
    ]);
    const svc = new WorkspaceStoreService(m as any);
    const out = await withTenant(() => svc.listReports({ page: 1, pageSize: 10 }));
    expect(out.total).toBe(2);
    expect(out.list.map((x) => x.id)).toEqual(['s1', 'w1']); // 08-27 > 08-25
    expect(out.list[0]).toMatchObject({ type: 'search', format: '智搜报告', version: 2, status: 'READY' });
    expect(out.list[1]).toMatchObject({ type: 'workspace', format: '分析报告', version: 1 });
  });

  it('无报告的 session 不出现在聚合列表', async () => {
    const m = mockDatasetPrisma();
    m.forTenant.searchSession.findMany.mockResolvedValue([{ id: 's0', question: '空', reports: [] }]);
    m.forTenant.workspaceReport.findMany.mockResolvedValue([]);
    const svc = new WorkspaceStoreService(m as any);
    const out = await withTenant(() => svc.listReports({ page: 1, pageSize: 10 }));
    expect(out.total).toBe(0);
  });

  it('keyword 传入两类查询的 where', async () => {
    const m = mockDatasetPrisma();
    m.forTenant.searchSession.findMany.mockResolvedValue([]);
    m.forTenant.workspaceReport.findMany.mockResolvedValue([]);
    const svc = new WorkspaceStoreService(m as any);
    await withTenant(() => svc.listReports({ keyword: 'GDP', page: 1, pageSize: 10 }));
    expect(m.forTenant.searchSession.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', question: { contains: 'GDP' } },
      include: { reports: { orderBy: { createdAt: 'desc' } } },
    });
    expect(m.forTenant.workspaceReport.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', title: { contains: 'GDP' } },
      orderBy: { createdAt: 'desc' },
    });
  });
});

describe('WorkspaceStoreService.listReportVersions', () => {
  it('search：同 session 多报告按时间升序编号', async () => {
    const m = mockDatasetPrisma();
    m.forTenant.searchSession.findFirst.mockResolvedValue({
      id: 's1',
      reports: [
        { id: 'r1', createdAt: new Date('2026-08-20T10:00:00Z'), tokenUsage: 10 },
        { id: 'r2', createdAt: new Date('2026-08-27T10:00:00Z'), tokenUsage: 20 },
      ],
    });
    const svc = new WorkspaceStoreService(m as any);
    const out = await withTenant(() => svc.listReportVersions('s1', 'search'));
    expect(out.list).toEqual([
      { id: 'r1', version: 1, createdAt: new Date('2026-08-20T10:00:00Z'), tokenUsage: 10 },
      { id: 'r2', version: 2, createdAt: new Date('2026-08-27T10:00:00Z'), tokenUsage: 20 },
    ]);
  });

  it('workspace：单条版本记录', async () => {
    const m = mockDatasetPrisma();
    m.forTenant.workspaceReport.findFirst.mockResolvedValue({
      id: 'w1', version: 3, createdAt: new Date('2026-08-28T10:00:00Z'),
    });
    const svc = new WorkspaceStoreService(m as any);
    const out = await withTenant(() => svc.listReportVersions('w1', 'workspace'));
    expect(out.list).toEqual([{ id: 'w1', version: 3, createdAt: new Date('2026-08-28T10:00:00Z') }]);
  });

  it('不存在时抛 404', async () => {
    const m = mockDatasetPrisma();
    m.forTenant.searchSession.findFirst.mockResolvedValue(null);
    m.forTenant.workspaceReport.findFirst.mockResolvedValue(null);
    const svc = new WorkspaceStoreService(m as any);
    await expect(withTenant(() => svc.listReportVersions('missing', 'search'))).rejects.toThrow(BizException);
    await expect(withTenant(() => svc.listReportVersions('missing', 'workspace'))).rejects.toThrow(BizException);
  });
});
