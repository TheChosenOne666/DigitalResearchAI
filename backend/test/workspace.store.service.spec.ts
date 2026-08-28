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
