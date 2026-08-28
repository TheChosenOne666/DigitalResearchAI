import { describe, expect, it, vi } from 'vitest';
import { parsePageParams, buildPageResult } from '../src/modules/admin/pagination';
import { AdminAuditService } from '../src/modules/admin/admin-audit.service';
import { tenantAls } from '../src/common/auth/tenant-context';

describe('parsePageParams（分页参数解析与收敛）', () => {
  it('默认分页：page=1 / pageSize=20', () => {
    const p = parsePageParams();
    expect(p.page).toBe(1);
    expect(p.pageSize).toBe(20);
    expect(p.skip).toBe(0);
    expect(p.take).toBe(20);
  });

  it('越界收敛：page<1 收敛到 1，pageSize 超上限收敛到 100', () => {
    const p = parsePageParams('0', '999');
    expect(p.page).toBe(1);
    expect(p.pageSize).toBe(100);
  });

  it('非法输入按默认兜底', () => {
    const p = parsePageParams('abc', 'xyz');
    expect(p.page).toBe(1);
    expect(p.pageSize).toBe(20);
  });

  it('skip = (page-1)*pageSize', () => {
    const p = parsePageParams('3', '20');
    expect(p.skip).toBe(40);
  });
});

describe('buildPageResult', () => {
  it('组装 list/total/page/pageSize', () => {
    const params = parsePageParams('2', '20');
    expect(buildPageResult([1, 2, 3], 55, params)).toEqual({
      list: [1, 2, 3],
      total: 55,
      page: 2,
      pageSize: 20,
    });
  });
});

describe('AdminAuditService.record', () => {
  it('在请求上下文中写入审计（action/目标/详情/租户/IP）', async () => {
    const create = vi.fn().mockResolvedValue({});
    const prisma = { auditLog: { create } } as never;
    const svc = new AdminAuditService(prisma);
    await tenantAls.run(
      { userId: 'u1', tenantId: 't1', roles: ['PLATFORM_ADMIN'] },
      () => svc.record({ targetType: 'indicator', targetId: 'i1', detail: { name: 'GDP' }, ip: '1.2.3.4' }),
    );
    expect(create).toHaveBeenCalledWith({
      data: {
        tenantId: 't1',
        userId: 'u1',
        action: 'ADMIN_OP',
        targetType: 'indicator',
        targetId: 'i1',
        detail: { name: 'GDP' },
        ip: '1.2.3.4',
      },
    });
  });

  it('审计写入失败不抛异常（降级只记日志）', async () => {
    const create = vi.fn().mockRejectedValue(new Error('write fail'));
    const svc = new AdminAuditService({ auditLog: { create } } as never);
    await expect(
      tenantAls.run(
        { userId: 'u1', tenantId: 't1', roles: ['PLATFORM_ADMIN'] },
        () => svc.record({ targetType: 'x', targetId: 'y' }),
      ),
    ).resolves.toBeUndefined();
  });
});
