import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  needsTenantFilter,
  applyTenantFilter,
  TENANT_MODELS,
} from '../src/common/prisma/tenant-filter';

const BACKEND_DIR = dirname(fileURLToPath(import.meta.url)) + '/..';

/** 解析 schema.prisma：模型名 → 是否声明了 tenantId 字段 */
function schemaTenantIdFlags(): Map<string, boolean> {
  const schema = readFileSync(resolve(BACKEND_DIR, 'prisma/schema.prisma'), 'utf8');
  const flags = new Map<string, boolean>();
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(schema)) !== null) {
    flags.set(m[1], /^\s*tenantId\s/m.test(m[2]));
  }
  return flags;
}

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

  it('findMany：where 缺省时也注入（否则退化为全表查询，跨租户泄漏）', () => {
    const out = applyTenantFilter({ orderBy: { createdAt: 'desc' } }, 'findMany', 't-1');
    expect(out.where).toEqual({ tenantId: 't-1' });
  });

  it('findUnique：where 缺省时同样注入 tenantId', () => {
    const out = applyTenantFilter({}, 'findUnique', 't-1');
    expect(out.where).toEqual({ tenantId: 't-1' });
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

  it('智搜从表已登记：检索快照/报告/章节/来源（修复跨租户读取检索快照）', () => {
    for (const model of ['SearchRetrieval', 'SearchReport', 'SearchReportSegment', 'SearchSource']) {
      expect(TENANT_MODELS.has(model), `${model} 未登记`).toBe(true);
      // 读路径必须注入（越权读取的修复点）；删除路径同样注入
      expect(needsTenantFilter(model, 'findFirst')).toBe(true);
      expect(needsTenantFilter(model, 'findMany')).toBe(true);
      expect(needsTenantFilter(model, 'deleteMany')).toBe(true);
    }
  });

  it('不变量：清单内每个模型在 schema 中都声明了 tenantId（防"登记了却没有列"）', () => {
    const flags = schemaTenantIdFlags();
    const missing = [...TENANT_MODELS].filter((m) => flags.get(m) !== true);
    expect(missing, `以下模型已登记但 schema 无 tenantId：${missing.join(', ')}`).toEqual([]);
  });
});
