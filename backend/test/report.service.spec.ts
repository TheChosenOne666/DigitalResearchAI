import { describe, it, expect, vi } from 'vitest';
import { tenantAls } from '../src/common/auth/tenant-context';
import { ReportService } from '../src/modules/report/report.service';
import { ReportController } from '../src/modules/report/report.controller';
import { BizException } from '../src/common/exceptions/biz.exception';

/** 在租户上下文内执行 */
function withTenant<T>(fn: () => T | Promise<T>): Promise<T> {
  return tenantAls.run({ tenantId: 't1', userId: 'u1', roles: ['USER'] }, fn);
}

function mockDeps() {
  const searchStore = { reportDetail: vi.fn() };
  const workspaceStore = { reportDetail: vi.fn() };
  const prisma = { auditLog: { create: vi.fn().mockResolvedValue({}) } };
  return { searchStore, workspaceStore, prisma };
}

describe('ReportService.export', () => {
  it('缺少 id 抛 400', async () => {
    const d = mockDeps();
    const svc = new ReportService(d.searchStore, d.workspaceStore, d.prisma as any);
    await expect(
      withTenant(() => svc.export({ type: 'search', id: '', format: 'docx' })),
    ).rejects.toThrow(BizException);
  });

  it('search 类型：取智搜报告生成 docx 并落审计', async () => {
    const d = mockDeps();
    d.searchStore.reportDetail.mockResolvedValue({
      id: 'rep1',
      contentMd: '## 结论\n数据来自世界银行{c:1}。',
      paramsSnapshot: { question: 'GDP 增长率对比' },
      tokenUsage: 10,
      createdAt: new Date('2026-08-28T10:00:00Z'),
      sources: [{ idx: 1, title: '世界银行 WDI', url: 'https://data.worldbank.org', snippet: 'WDI 数据库' }],
    });
    const svc = new ReportService(d.searchStore, d.workspaceStore, d.prisma as any);
    const out = await withTenant(() => svc.export({ type: 'search', id: 'sess1', format: 'docx' }));
    expect(out.buffer.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(out.filename).toBe('GDP 增长率对比.docx');
    expect(out.contentType).toContain('wordprocessingml');
    // 审计：action=EXPORT + type/format
    expect(d.prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'EXPORT', targetId: 'sess1', detail: { type: 'search', format: 'docx' } }),
    });
  });

  it('workspace 类型：取分析报告生成 pptx，标题取 report.title', async () => {
    const d = mockDeps();
    d.workspaceStore.reportDetail.mockResolvedValue({
      id: 'wr1',
      title: 'GDP 分析报告',
      contentMd: '## 摘要\n内容',
      paramsSnapshot: { countries: ['中国', '美国'] },
      sources: [],
      tokenUsage: 5,
      status: 'DRAFT',
      version: 1,
      createdAt: new Date('2026-08-28T10:00:00Z'),
      updatedAt: new Date('2026-08-28T10:00:00Z'),
    });
    const svc = new ReportService(d.searchStore, d.workspaceStore, d.prisma as any);
    const out = await withTenant(() => svc.export({ type: 'workspace', id: 'wr1', format: 'pptx' }));
    expect(out.buffer.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(out.filename).toBe('GDP 分析报告.pptx');
    expect(out.contentType).toContain('presentationml');
  });

  it('审计写入失败不阻塞导出主流程', async () => {
    const d = mockDeps();
    d.searchStore.reportDetail.mockResolvedValue({
      id: 'rep1',
      contentMd: '正文',
      paramsSnapshot: { question: '问题' },
      tokenUsage: 1,
      createdAt: new Date(),
      sources: [],
    });
    d.prisma.auditLog.create.mockRejectedValue(new Error('db down'));
    const svc = new ReportService(d.searchStore, d.workspaceStore, d.prisma as any);
    const out = await withTenant(() => svc.export({ type: 'search', id: 's1', format: 'docx' }));
    expect(out.buffer.length).toBeGreaterThan(0);
  });

  it('标题含非法文件名字符时安全化', async () => {
    const d = mockDeps();
    d.workspaceStore.reportDetail.mockResolvedValue({
      id: 'wr1',
      title: 'a/b\\c:*?"<>|',
      contentMd: 'x',
      paramsSnapshot: {},
      sources: [],
      tokenUsage: 0,
      status: 'DRAFT',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const svc = new ReportService(d.searchStore, d.workspaceStore, d.prisma as any);
    const out = await withTenant(() => svc.export({ type: 'workspace', id: 'wr1', format: 'docx' }));
    expect(out.filename).toBe('abc.docx');
  });
});

describe('ReportController.export 入参校验', () => {
  function mockRes() {
    return {
      headers: {} as Record<string, unknown>,
      setHeader: vi.fn(function (this: any, k: string, v: unknown) {
        this.headers[k] = v;
      }),
      end: vi.fn(),
    };
  }

  it('非法 type 抛 400 业务异常', async () => {
    const svc = { export: vi.fn() };
    const ctl = new ReportController(svc as any);
    await expect(ctl.export({ type: 'other', id: 'x', format: 'docx' }, mockRes() as any)).rejects.toThrow(
      BizException,
    );
    expect(svc.export).not.toHaveBeenCalled();
  });

  it('非法 format 抛 400 业务异常', async () => {
    const svc = { export: vi.fn() };
    const ctl = new ReportController(svc as any);
    await expect(ctl.export({ type: 'search', id: 'x', format: 'pdf' }, mockRes() as any)).rejects.toThrow(
      BizException,
    );
    expect(svc.export).not.toHaveBeenCalled();
  });

  it('合法入参直接写二进制流响应头并 end', async () => {
    const svc = {
      export: vi.fn().mockResolvedValue({
        buffer: Buffer.from('fake'),
        filename: '报告.docx',
        contentType: 'application/x',
      }),
    };
    const ctl = new ReportController(svc as any);
    const res = mockRes();
    await ctl.export({ type: 'search', id: 's1', format: 'docx' }, res as any);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/x');
    expect(res.end).toHaveBeenCalledWith(Buffer.from('fake'));
  });
});
