import { describe, expect, it, vi } from 'vitest';
import { AdminIndicatorsService } from '../src/modules/admin/indicators.service';
import { ErrorCode } from '@app/shared';

/** 构造最小 Prisma mock（覆盖指标/映射模型） */
function buildPrisma(overrides: Record<string, unknown> = {}) {
  const prisma = {
    indicator: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue({ id: 'i1' }),
    },
    indicatorMapping: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue({ id: 'm1' }),
    },
    ...overrides,
  };
  return prisma;
}

describe('AdminIndicatorsService.list（指标列表）', () => {
  it('返回含映射数量的指标行', async () => {
    const prisma = buildPrisma({
      indicator: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'i1',
            code: 'GDP_YOY',
            name: 'GDP 同比增速',
            category: '宏观经济',
            unit: '%',
            definition: '不变价 GDP 同比',
            enabled: true,
            createdAt: new Date(),
            mappings: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }],
          },
        ]),
      },
    });
    const svc = new AdminIndicatorsService(prisma as never);
    const res = await svc.list({ keyword: '', category: '', enabled: '', page: 1, pageSize: 20 });
    expect(res.total).toBe(1);
    expect(res.list[0].code).toBe('GDP_YOY');
    expect(res.list[0].mappingCount).toBe(3);
  });
});

describe('AdminIndicatorsService.create（新增指标）', () => {
  it('编码已存在 → 抛 CONFLICT', async () => {
    const prisma = buildPrisma({ indicator: { findFirst: vi.fn().mockResolvedValue({ id: 'i1' }) } });
    const svc = new AdminIndicatorsService(prisma as never);
    await expect(
      svc.create({ code: 'GDP_YOY', name: 'x', category: 'c', unit: '%' }),
    ).rejects.toMatchObject({ bizCode: ErrorCode.CONFLICT });
  });

  it('正常创建返回指标行', async () => {
    const prisma = buildPrisma();
    prisma.indicator.create = vi.fn().mockResolvedValue({
      id: 'i1',
      code: 'GDP_YOY',
      name: 'GDP 同比增速',
      category: '宏观经济',
      unit: '%',
      definition: null,
      enabled: true,
      createdAt: new Date(),
      mappings: [],
    }) as never;
    const svc = new AdminIndicatorsService(prisma as never);
    const row = await svc.create({ code: 'GDP_YOY', name: 'GDP 同比增速', category: '宏观经济', unit: '%' });
    expect(row.code).toBe('GDP_YOY');
    expect(row.mappingCount).toBe(0);
  });
});

describe('AdminIndicatorsService.remove（删除指标）', () => {
  it('存在来源映射 → 禁删（CONFLICT）', async () => {
    const prisma = buildPrisma({
      indicator: { findUnique: vi.fn().mockResolvedValue({ id: 'i1', mappings: [{ id: 'm1' }] }) },
    });
    const svc = new AdminIndicatorsService(prisma as never);
    await expect(svc.remove('i1')).rejects.toMatchObject({ bizCode: ErrorCode.CONFLICT });
  });

  it('无映射 → 直接删除', async () => {
    const prisma = buildPrisma({
      indicator: {
        findUnique: vi.fn().mockResolvedValue({ id: 'i1', mappings: [] }),
        delete: vi.fn().mockResolvedValue({ id: 'i1' }),
      },
    });
    const svc = new AdminIndicatorsService(prisma as never);
    const res = await svc.remove('i1');
    expect(res.ok).toBe(true);
    expect(prisma.indicator.delete).toHaveBeenCalledWith({ where: { id: 'i1' } });
  });
});

describe('AdminIndicatorsService 映射 CRUD', () => {
  it('指标不存在新增映射 → NOT_FOUND', async () => {
    const prisma = buildPrisma();
    const svc = new AdminIndicatorsService(prisma as never);
    await expect(
      svc.createMapping('nope', { sourceName: '世界银行', sourceField: 'X' }),
    ).rejects.toMatchObject({ bizCode: ErrorCode.NOT_FOUND });
  });

  it('正常新增映射返回映射行', async () => {
    const prisma = buildPrisma();
    prisma.indicator.findUnique = vi.fn().mockResolvedValue({ id: 'i1' }) as never;
    prisma.indicatorMapping.create = vi.fn().mockResolvedValue({
      id: 'm1',
      indicatorId: 'i1',
      sourceName: '世界银行 WDI',
      sourceField: 'NY.GDP.MKTP.KD.ZG',
      transform: null,
      enabled: true,
    }) as never;
    const svc = new AdminIndicatorsService(prisma as never);
    const row = await svc.createMapping('i1', { sourceName: '世界银行 WDI', sourceField: 'NY.GDP.MKTP.KD.ZG' });
    expect(row.sourceName).toBe('世界银行 WDI');
  });
});
