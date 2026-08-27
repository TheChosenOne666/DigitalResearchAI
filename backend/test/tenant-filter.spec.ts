import { describe, expect, it } from 'vitest';
import {
  needsTenantFilter,
  applyTenantFilter,
  TENANT_MODELS,
} from '../src/common/prisma/tenant-filter';

describe('tenant-filter（租户强制注入纯函数）', () => {
  it('隔离清单内的模型 + 查询操作 → 需要注入', () => {
    expect(needsTenantFilter('User', 'findMany')).toBe(true);
    expect(needsTenantFilter('AuditLog', 'updateMany')).toBe(true);
    expect(needsTenantFilter('User', 'delete')).toBe(true);
    expect(needsTenantFilter('User', 'create')).toBe(true);
    expect(needsTenantFilter('User', 'createMany')).toBe(true);
    expect(needsTenantFilter('User', 'upsert')).toBe(true);
    expect(needsTenantFilter('User', 'count')).toBe(true);
  });

  it('隔离清单外的模型（Role/Tenant 等）→ 不注入', () => {
    expect(needsTenantFilter('Role', 'findMany')).toBe(false);
    expect(needsTenantFilter('Tenant', 'findMany')).toBe(false);
    expect(needsTenantFilter(undefined, 'findMany')).toBe(false);
  });

  it('清单内模型但未知操作 → 不注入（保守放行，由调用方语义保证）', () => {
    expect(needsTenantFilter('User', 'findRaw')).toBe(false);
  });

  it('findMany：where 注入 tenantId，原参数不被修改', () => {
    const args = { where: { status: 'ACTIVE' } };
    const out = applyTenantFilter(args, 'findMany', 't-1');
    expect(out.where).toEqual({ status: 'ACTIVE', tenantId: 't-1' });
    expect(args.where).toEqual({ status: 'ACTIVE' }); // 原对象未被改
  });

  it('create：data 注入 tenantId', () => {
    const out = applyTenantFilter({ data: { phone: '13800001111' } }, 'create', 't-1');
    expect(out.data).toEqual({ phone: '13800001111', tenantId: 't-1' });
  });

  it('createMany：数组每项注入', () => {
    const out = applyTenantFilter(
      { data: [{ action: 'A' }, { action: 'B' }] },
      'createMany',
      't-1',
    );
    expect(out.data).toEqual([
      { action: 'A', tenantId: 't-1' },
      { action: 'B', tenantId: 't-1' },
    ]);
  });

  it('upsert：where/create/update 三处注入', () => {
    const out = applyTenantFilter(
      { where: { id: 'u1' }, create: { name: 'a' }, update: { name: 'b' } },
      'upsert',
      't-1',
    );
    expect(out.where).toEqual({ id: 'u1', tenantId: 't-1' });
    expect(out.create).toEqual({ name: 'a', tenantId: 't-1' });
    expect(out.update).toEqual({ name: 'b', tenantId: 't-1' });
  });

  it('跨租户攻击模拟：显式传入他人 tenantId 被本租户覆盖（防越权兜底）', () => {
    const out = applyTenantFilter(
      { where: { tenantId: 'victim-tenant', id: 'u1' } },
      'findMany',
      'attacker-tenant',
    );
    expect(out.where.tenantId).toBe('attacker-tenant');
  });
});

describe('TENANT_MODELS 隔离清单', () => {
  it('M1 模型已登记', () => {
    expect(TENANT_MODELS.has('User')).toBe(true);
    expect(TENANT_MODELS.has('AuditLog')).toBe(true);
  });
});
