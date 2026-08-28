import { describe, expect, it, vi } from 'vitest';
import { SearchStoreService } from '../src/modules/search/persistence/search.store.service';

/** 构造最小 Prisma mock（覆盖敏感词/审计/搜索词模型） */
function buildPrisma(overrides: Record<string, unknown> = {}) {
  const prisma = {
    sensitiveWord: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({ id: 'w1' }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'a1' }) },
    searchTerm: { upsert: vi.fn().mockResolvedValue({ id: 's1' }) },
    ...overrides,
  };
  return prisma;
}

describe('SearchStoreService.checkSensitiveWord（敏感词拦截 D8）', () => {
  it('未命中启用敏感词 → 返回 null', async () => {
    const prisma = buildPrisma({
      sensitiveWord: {
        findMany: vi.fn().mockResolvedValue([{ id: 'w1', word: '违禁词', enabled: true }]),
        update: vi.fn().mockResolvedValue({ id: 'w1' }),
      },
    });
    const svc = new SearchStoreService(prisma as never);
    const hit = await svc.checkSensitiveWord('中国 GDP 增长率');
    expect(hit).toBeNull();
    expect(prisma.sensitiveWord.update).not.toHaveBeenCalled();
  });

  it('命中敏感词 → 累加 hitCount + 落审计 + 返回命中词', async () => {
    const prisma = buildPrisma({
      sensitiveWord: {
        findMany: vi.fn().mockResolvedValue([{ id: 'w1', word: '违禁词', enabled: true }]),
        update: vi.fn().mockResolvedValue({ id: 'w1' }),
      },
    });
    const svc = new SearchStoreService(prisma as never);
    const hit = await svc.checkSensitiveWord('查询违禁词相关内容');
    expect(hit).toBe('违禁词');
    expect(prisma.sensitiveWord.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'w1' }, data: { hitCount: { increment: 1 } } }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'SEARCH_BLOCKED' }) }),
    );
  });

  it('忽略已停用敏感词', async () => {
    // 停用词会被 where { enabled: true } 过滤，查询结果为空
    const prisma = buildPrisma({
      sensitiveWord: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({ id: 'w1' }),
      },
    });
    const svc = new SearchStoreService(prisma as never);
    const hit = await svc.checkSensitiveWord('查询违禁词相关内容');
    expect(hit).toBeNull();
  });

  it('空问题 → 直接返回 null', async () => {
    const prisma = buildPrisma();
    const svc = new SearchStoreService(prisma as never);
    expect(await svc.checkSensitiveWord('   ')).toBeNull();
    expect(prisma.sensitiveWord.findMany).not.toHaveBeenCalled();
  });
});

describe('SearchStoreService.trackSearchTerm（搜索词统计 A-10）', () => {
  it('空词跳过', async () => {
    const prisma = buildPrisma();
    const svc = new SearchStoreService(prisma as never);
    await svc.trackSearchTerm('   ', false);
    expect(prisma.searchTerm.upsert).not.toHaveBeenCalled();
  });

  it('有结果 → totalCount+1，emptyCount 不变', async () => {
    const prisma = buildPrisma();
    const svc = new SearchStoreService(prisma as never);
    await svc.trackSearchTerm('中国 GDP', false);
    expect(prisma.searchTerm.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { term: '中国 GDP' },
        update: expect.objectContaining({ totalCount: { increment: 1 }, emptyCount: { increment: 0 } }),
      }),
    );
  });

  it('无结果 → totalCount+1 且 emptyCount+1', async () => {
    const prisma = buildPrisma();
    const svc = new SearchStoreService(prisma as never);
    await svc.trackSearchTerm('冷门词', true);
    expect(prisma.searchTerm.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ totalCount: { increment: 1 }, emptyCount: { increment: 1 } }),
      }),
    );
  });
});
