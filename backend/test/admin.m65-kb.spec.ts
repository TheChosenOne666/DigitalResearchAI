import { describe, expect, it, vi } from 'vitest';
import { KbReviewAdminService } from '../src/modules/admin/kb-review.admin.service';
import { KbTaxonomyAdminService } from '../src/modules/admin/kb-taxonomy.admin.service';
import { KbPermAdminService } from '../src/modules/admin/kb-perm.admin.service';
import { KbIndexAdminService } from '../src/modules/admin/kb-index.admin.service';
import { ErrorCode } from '@app/shared';

// mock bullmq：避免真实包冷导入（全量并发下可达 10s+ 触发单测超时）；
// REDIS_URL 配置为非法值，队列工厂在连接解析处抛错降级，不会走到 Queue 实例化
vi.mock('bullmq', () => ({
  Queue: class {
    add = vi.fn().mockResolvedValue({ id: 'job-1' });
  },
  Worker: class {},
}));

/** 构造队列不可用的 ConfigService mock（REDIS_URL 非法 → 降级同步学习路径） */
function buildConfig() {
  return { get: (key: string, dflt?: string) => (key === 'REDIS_URL' ? 'invalid-url' : dflt) };
}

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    kbDocument: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(null),
    },
    kbLibrary: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null) },
    kbGroup: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null) },
    kbCategory: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue(null) },
    kbTag: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue(null) },
    tenant: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null) },
    searchSession: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null) },
    user: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null) },
    sensitiveWord: { findMany: vi.fn().mockResolvedValue([]) },
    sysConfig: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockResolvedValue(null) },
    sysTask: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue(null) },
    taskLog: { create: vi.fn().mockResolvedValue(null) },
    kbChunk: { count: vi.fn().mockResolvedValue(0) },
    ...overrides,
  };
}

function buildLearning() {
  return {
    learn: vi.fn().mockResolvedValue(3),
    markFailed: vi.fn().mockResolvedValue(undefined),
  };
}

/** 构造审核服务（A-16，需学习服务与队列配置） */
function makeReviewService(prisma: Record<string, unknown>) {
  return new KbReviewAdminService(prisma as never, buildLearning() as never, buildConfig() as never);
}

describe('知识库管理（A-16~A-19，按域拆分后的服务）', () => {
  // ===== A-16 知识审核（KbReviewAdminService）=====

  it('listReviews：返回校验结果（同名疑似重复 / 缺少引用来源 / 敏感词命中）', async () => {
    const doc = {
      id: 'd1', tenantId: 't1', libraryId: 'lib1', groupId: null, name: '2025 能源政策',
      mimeType: 'md', size: 1024, visibility: 'PRIVATE', tags: ['能源'], sourceSessionId: null,
      createdAt: new Date(),
    };
    const prisma = buildPrisma({
      kbDocument: {
        ...buildPrisma().kbDocument,
        count: vi.fn().mockResolvedValue(1),
        // 第一次调用=分页查询，第二次=同名检测
        findMany: vi.fn().mockResolvedValueOnce([doc]).mockResolvedValueOnce([{ libraryId: 'lib1', name: '2025 能源政策' }]),
      },
      tenant: { findMany: vi.fn().mockResolvedValue([{ id: 't1', name: '智库研究部' }]) },
      kbLibrary: { findMany: vi.fn().mockResolvedValue([{ id: 'lib1', name: '宏观经济库' }]), findUnique: vi.fn() },
      sensitiveWord: { findMany: vi.fn().mockResolvedValue([{ word: '能源' }]) },
    });
    const svc = makeReviewService(prisma);
    const res = await svc.listReviews({ page: 1, pageSize: 20 });

    expect(res.total).toBe(1);
    const row = res.list[0];
    expect(row.tenantName).toBe('智库研究部');
    expect(row.libraryName).toBe('宏观经济库');
    expect(row.sourceType).toBe('手动上传');
    expect(row.checks.duplicate).toMatchObject({ status: 'WARN' });
    expect(row.checks.complete).toMatchObject({ status: 'WARN', note: '缺少引用来源字段' });
    expect(row.checks.compliance).toMatchObject({ status: 'FAIL' });
    expect(row.checks.format).toMatchObject({ status: 'PASS' });
  });

  it('approveReview：文档不存在 / 非待审核状态被拒', async () => {
    const prisma = buildPrisma({ kbDocument: { ...buildPrisma().kbDocument, findUnique: vi.fn().mockResolvedValue(null) } });
    const svc = makeReviewService(prisma);
    await expect(svc.approveReview('x')).rejects.toMatchObject({ bizCode: ErrorCode.NOT_FOUND });

    const prisma2 = buildPrisma({
      kbDocument: {
        ...buildPrisma().kbDocument,
        findUnique: vi.fn().mockResolvedValue({ id: 'd1', tenantId: 't1', mimeType: 'md', status: 'LEARNING', fileData: Buffer.from('x') }),
      },
    });
    const svc2 = makeReviewService(prisma2);
    await expect(svc2.approveReview('d1')).rejects.toMatchObject({ bizCode: ErrorCode.VALIDATION_FAILED });
  });

  it('approveReview：原始内容缺失标记失败并拒绝；有内容降级同步学习成功', async () => {
    const prisma = buildPrisma({
      kbDocument: {
        ...buildPrisma().kbDocument,
        findUnique: vi.fn().mockResolvedValue({ id: 'd1', tenantId: 't1', mimeType: 'md', status: 'PENDING', fileData: null }),
      },
    });
    const learning = buildLearning();
    const svc = new KbReviewAdminService(prisma as never, learning as never, buildConfig() as never);
    await expect(svc.approveReview('d1')).rejects.toMatchObject({ bizCode: ErrorCode.VALIDATION_FAILED });
    expect(learning.markFailed).toHaveBeenCalledWith('t1', 'd1', '原始内容缺失');

    const prisma2 = buildPrisma({
      kbDocument: {
        ...buildPrisma().kbDocument,
        findUnique: vi.fn().mockResolvedValue({ id: 'd2', tenantId: 't1', mimeType: 'md', status: 'PENDING', fileData: Buffer.from('内容') }),
      },
    });
    const svc2 = new KbReviewAdminService(prisma2 as never, learning as never, buildConfig() as never);
    const res = await svc2.approveReview('d2');
    expect(res).toEqual({ id: 'd2', status: 'LEARNING' });
    expect(learning.learn).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', documentId: 'd2' }));
  });

  it('rejectReview：删除待审核文档并带回原因；非待审核被拒', async () => {
    const del = vi.fn().mockResolvedValue(null);
    const prisma = buildPrisma({
      kbDocument: {
        ...buildPrisma().kbDocument,
        findUnique: vi.fn().mockResolvedValue({ id: 'd1', status: 'PENDING', name: 'a' }),
        delete: del,
      },
    });
    const svc = makeReviewService(prisma);
    await expect(svc.rejectReview('d1', '内容不符合要求')).resolves.toEqual({ id: 'd1', rejected: true, reason: '内容不符合要求' });
    expect(del).toHaveBeenCalledWith({ where: { id: 'd1' } });
  });

  it('trace：带出租户/库/提交人/来源类型', async () => {
    const prisma = buildPrisma({
      kbDocument: {
        ...buildPrisma().kbDocument,
        findUnique: vi.fn().mockResolvedValue({
          id: 'd1', tenantId: 't1', libraryId: 'lib1', groupId: null, name: 'a', mimeType: 'md',
          size: 10, status: 'PENDING', visibility: 'PRIVATE', tags: [], sourceSessionId: 's1', createdAt: new Date(),
        }),
      },
      tenant: { findMany: vi.fn(), findUnique: vi.fn().mockResolvedValue({ name: '智库研究部' }) },
      kbLibrary: { findMany: vi.fn(), findUnique: vi.fn().mockResolvedValue({ name: '宏观经济库' }) },
      searchSession: { findMany: vi.fn(), findUnique: vi.fn().mockResolvedValue({ id: 's1', question: '2025 GDP 增速', userId: 'u1' }) },
      user: { findMany: vi.fn(), findUnique: vi.fn().mockResolvedValue({ id: 'u1', username: 'zhang', realName: '张研究', nickname: null }) },
    });
    const svc = makeReviewService(prisma);
    const res = await svc.trace('d1');
    expect(res.tenantName).toBe('智库研究部');
    expect(res.sourceType).toBe('检索成果入库（U-11）');
    expect(res.sourceQuestion).toBe('2025 GDP 增速');
    expect(res.submitter).toEqual({ id: 'u1', name: '张研究' });
  });

  // ===== A-17 分类 / 标签（KbTaxonomyAdminService）=====

  it('createCategory：层级上限 3 级', async () => {
    const prisma = buildPrisma({
      kbCategory: {
        ...buildPrisma().kbCategory,
        findUnique: vi.fn().mockResolvedValue({ id: 'p1', level: 3 }),
      },
    });
    const svc = new KbTaxonomyAdminService(prisma as never);
    await expect(svc.createCategory({ name: 'x', parentId: 'p1' })).rejects.toMatchObject({ bizCode: ErrorCode.VALIDATION_FAILED });
  });

  it('createTag：重名冲突', async () => {
    const prisma = buildPrisma({
      kbTag: { ...buildPrisma().kbTag, findUnique: vi.fn().mockResolvedValue({ id: 't9', name: 'GDP' }) },
    });
    const svc = new KbTaxonomyAdminService(prisma as never);
    await expect(svc.createTag({ name: 'GDP' })).rejects.toMatchObject({ bizCode: ErrorCode.CONFLICT });
  });

  // ===== A-18 权限管理（KbPermAdminService）=====

  it('updatePermissionRule：值域校验 + 落 sys_configs', async () => {
    const upsert = vi.fn().mockResolvedValue(null);
    const findMany = vi.fn().mockResolvedValue([
      { key: 'kb.defaultVisibility', value: 'PUBLIC' },
      { key: 'kb.privateScope', value: 'ORG' },
    ]);
    const prisma = buildPrisma({ sysConfig: { findMany, upsert } });
    const svc = new KbPermAdminService(prisma as never);
    await expect(svc.updatePermissionRule({ defaultVisibility: 'EVERYONE' as never })).rejects.toMatchObject({ bizCode: ErrorCode.VALIDATION_FAILED });

    const res = await svc.updatePermissionRule({ defaultVisibility: 'PUBLIC', privateScope: 'ORG' });
    expect(res).toEqual({ defaultVisibility: 'PUBLIC', privateScope: 'ORG' });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'kb.defaultVisibility' } }));
  });

  it('setItemVisibility：重复切换被拒，正常切换更新', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'd1', visibility: 'PUBLIC' });
    const prisma = buildPrisma({
      kbDocument: {
        ...buildPrisma().kbDocument,
        findUnique: vi.fn().mockResolvedValue({ id: 'd1', visibility: 'PUBLIC', name: 'a' }),
        update,
      },
    });
    const svc = new KbPermAdminService(prisma as never);
    await expect(svc.setItemVisibility('d1', 'PUBLIC')).rejects.toMatchObject({ bizCode: ErrorCode.VALIDATION_FAILED });
    await expect(svc.setItemVisibility('d1', 'PRIVATE')).resolves.toEqual({ id: 'd1', visibility: 'PUBLIC' });
    expect(update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { visibility: 'PRIVATE' } });
  });

  // ===== A-19 索引管理（KbIndexAdminService）=====

  it('indexStats：条目/切片/待增量统计 + 上次重建', async () => {
    const prisma = buildPrisma({
      kbDocument: { ...buildPrisma().kbDocument, count: vi.fn().mockResolvedValue(12) },
      kbChunk: {
        count: vi.fn()
          .mockResolvedValueOnce(12640)
          .mockResolvedValueOnce(86),
      },
      sysTask: {
        ...buildPrisma().sysTask,
        findMany: vi.fn().mockResolvedValue([
          { id: 'tk1', taskNo: 'IDX-20260801-001', type: 'INDEX', status: 'SUCCESS', progress: 100, payload: { action: 'REBUILD' }, createdAt: new Date(), updatedAt: new Date() },
          { id: 'tk2', taskNo: 'IDX-20260802-001', type: 'INDEX', status: 'WAITING', progress: 0, payload: { action: 'INCREMENT' }, createdAt: new Date(), updatedAt: new Date() },
        ]),
      },
    });
    const svc = new KbIndexAdminService(prisma as never);
    const res = await svc.indexStats();
    expect(res).toMatchObject({ totalDocs: 12, totalChunks: 12640, pendingChunks: 86 });
    expect(res.lastRebuildAt).not.toBeNull();
    expect(res.recentTasks).toHaveLength(2);
  });

  it('createIndexTask：登记 INDEX 任务 + INFO 日志（不真改索引）', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'tk1', taskNo: 'IDX-20260829-001', status: 'WAITING', createdAt: new Date() });
    const prisma = buildPrisma({ sysTask: { ...buildPrisma().sysTask, create } });
    const svc = new KbIndexAdminService(prisma as never);
    const res = await svc.createIndexTask('REBUILD');
    expect(res.taskNo).toMatch(/^IDX-\d{8}-\d{3}$/);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'INDEX', status: 'WAITING', stage: 'REBUILD' }) }));
    expect(prisma.taskLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ level: 'INFO' }) }));
  });
});
