import { describe, it, expect, vi } from 'vitest';
import { tenantAls } from '../src/common/auth/tenant-context';
import { SearchTaskService } from '../src/modules/search/task/search-task.service';
import { SearchTaskStoreService } from '../src/modules/search/persistence/search-task.store.service';
import { RETRIEVAL_TTL_SECONDS } from '../src/modules/search/search.constants';
import type { SearchTaskRow } from '../src/modules/search/persistence/search-task.store.service';

/** 构造任务行 */
function taskRow(over: Partial<SearchTaskRow> = {}): SearchTaskRow {
  return {
    id: 't1',
    sessionId: 's1',
    type: 'generate',
    status: 'GENERATING',
    progress: 0,
    errorMsg: null,
    question: '问题',
    createdAt: new Date(),
    updatedAt: new Date(),
    finishedAt: null,
    resumableSeconds: null,
    ...over,
  };
}

function mockStore() {
  return {
    create: vi.fn().mockResolvedValue({ id: 't1' }),
    update: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    get: vi.fn().mockResolvedValue(null),
    remove: vi.fn().mockResolvedValue(true),
    reapStale: vi.fn().mockResolvedValue(0),
    // 续跑抢占（CAS）：默认抢占成功
    updateIfStatus: vi.fn().mockResolvedValue(true),
  };
}

function build() {
  const store = mockStore();
  // 18 批 3 联动：任务删除时清理上传资料
  const upload = { cleanupExpired: vi.fn().mockResolvedValue(0) };
  return { store, upload, svc: new SearchTaskService(store as any, upload as any) };
}

describe('SearchTaskService（任务状态机）', () => {
  it('创建检索任务：初始状态 RETRIEVING，返回任务 id', async () => {
    const { store, svc } = build();
    const id = await svc.startRetrieval('s1');
    expect(id).toBe('t1');
    expect(store.create).toHaveBeenCalledWith('s1', 'retrieval', 'RETRIEVING');
  });

  it('创建生成任务：初始状态 GENERATING', async () => {
    const { store, svc } = build();
    const id = await svc.startGenerate('s2');
    expect(id).toBe('t1');
    expect(store.create).toHaveBeenCalledWith('s2', 'generate', 'GENERATING');
  });

  it('检索完成 → PENDING_SELECT（进度 100，不占资源）', async () => {
    const { store, svc } = build();
    await svc.markPendingSelect('t1');
    expect(store.update).toHaveBeenCalledWith('t1', { status: 'PENDING_SELECT', progress: 100 });
  });

  it('进度按已完成章节折算（3 章 → 33/67/100）', async () => {
    const { store, svc } = build();
    await svc.updateProgress('t1', 1, 3);
    expect(store.update).toHaveBeenLastCalledWith('t1', { progress: 33 });
    await svc.updateProgress('t1', 2, 3);
    expect(store.update).toHaveBeenLastCalledWith('t1', { progress: 67 });
    await svc.updateProgress('t1', 3, 3);
    expect(store.update).toHaveBeenLastCalledWith('t1', { progress: 100 });
  });

  it('markDone：状态 DONE + 清空错误 + 标记结束', async () => {
    const { store, svc } = build();
    await svc.markDone('t1');
    expect(store.update).toHaveBeenCalledWith('t1', {
      status: 'DONE',
      progress: 100,
      errorMsg: null,
      finish: true,
    });
  });

  it('markFailed：错误信息截断到 500 字并结束', async () => {
    const { store, svc } = build();
    await svc.markFailed('t1', 'GENERATE_FAILED', 'x'.repeat(900));
    const arg = store.update.mock.calls[0][1];
    expect(arg.status).toBe('GENERATE_FAILED');
    expect(arg.errorMsg).toHaveLength(500);
    expect(arg.finish).toBe(true);
  });

  it('requestAbort：进行中的任务可中止（写 ABORTED 作为信号）', async () => {
    const { store, svc } = build();
    store.get.mockResolvedValue(taskRow({ status: 'GENERATING' }));
    const row = await svc.requestAbort('t1');
    expect(row.status).toBe('ABORTED');
    expect(store.update).toHaveBeenCalledWith('t1', {
      status: 'ABORTED',
      errorMsg: '已中止，可继续生成',
      finish: true,
    });
  });

  it('requestAbort：已结束任务抛 409', async () => {
    const { store, svc } = build();
    store.get.mockResolvedValue(taskRow({ status: 'DONE' }));
    await expect(svc.requestAbort('t1')).rejects.toMatchObject({ bizCode: 4002 });
  });

  it('requestAbort：任务不存在抛 404', async () => {
    const { store, svc } = build();
    store.get.mockResolvedValue(null);
    await expect(svc.requestAbort('t1')).rejects.toMatchObject({ bizCode: 4001 });
  });

  it('isAborted：状态为 ABORTED 时返回 true', async () => {
    const { store, svc } = build();
    store.get.mockResolvedValue(taskRow({ status: 'ABORTED' }));
    expect(await svc.isAborted('t1')).toBe(true);
  });

  it('isAborted：查询异常按「未中止」处理（不误判为流程异常）', async () => {
    const { store, svc } = build();
    store.get.mockRejectedValue(new Error('db down'));
    expect(await svc.isAborted('t1')).toBe(false);
  });

  it('ensureResumable：非生成任务抛 400', async () => {
    const { store, svc } = build();
    store.get.mockResolvedValue(taskRow({ type: 'retrieval', status: 'RETRIEVAL_FAILED' }));
    await expect(svc.ensureResumable('t1')).rejects.toMatchObject({ bizCode: 3001 });
  });

  it('ensureResumable：进行中任务不可续跑（409）', async () => {
    const { store, svc } = build();
    store.get.mockResolvedValue(taskRow({ status: 'GENERATING' }));
    await expect(svc.ensureResumable('t1')).rejects.toMatchObject({ bizCode: 4002 });
  });

  it('ensureResumable：中断/失败任务放行', async () => {
    const { store, svc } = build();
    for (const status of ['GENERATE_FAILED', 'ABORTED'] as const) {
      store.get.mockResolvedValue(taskRow({ status }));
      const row = await svc.ensureResumable('t1');
      expect(row.status).toBe(status);
    }
  });

  it('claimForResume：仅当任务处于可续跑态（ABORTED / GENERATE_FAILED）才置为进行中', async () => {
    const { store, svc } = build();
    await svc.claimForResume('t1', 33);
    expect(store.updateIfStatus).toHaveBeenCalledWith('t1', ['ABORTED', 'GENERATE_FAILED'], {
      status: 'GENERATING',
      progress: 33,
      errorMsg: null,
    });
  });

  it('claimForResume：状态已被改变（并发/重复点击）抛 409，不重复跑', async () => {
    const { store, svc } = build();
    store.updateIfStatus.mockResolvedValue(false);
    await expect(svc.claimForResume('t1', 33)).rejects.toMatchObject({ bizCode: 4002 });
  });

  it('remove：删除失败（不存在）抛 404', async () => {
    const { store, svc } = build();
    store.remove.mockResolvedValue(false);
    await expect(svc.remove('t1')).rejects.toMatchObject({ bizCode: 4001 });
  });

  it('remove：删除成功后顺手清理该用户已过期上传资料（18 批 3 联动）', async () => {
    const { store, upload, svc } = build();
    store.remove.mockResolvedValue(true);
    await tenantAls.run({ tenantId: 't1', userId: 'u1', roles: ['USER'] }, () => svc.remove('t1'));
    expect(upload.cleanupExpired).toHaveBeenCalledWith('u1');
  });

  it('remove：清理资料失败不影响删除结果', async () => {
    const { store, upload, svc } = build();
    store.remove.mockResolvedValue(true);
    upload.cleanupExpired.mockRejectedValue(new Error('db down'));
    await expect(
      tenantAls.run({ tenantId: 't1', userId: 'u1', roles: ['USER'] }, () => svc.remove('t1')),
    ).resolves.toBeUndefined();
  });

  it('reapStale：委托 store 收敛僵尸任务', async () => {
    const { store, svc } = build();
    store.reapStale.mockResolvedValue(2);
    expect(await svc.reapStale(1000)).toBe(2);
    expect(store.reapStale).toHaveBeenCalledWith(1000);
  });
});

/** 在租户上下文内执行（模拟受保护路由的拦截器注入） */
function withTenant<T>(fn: () => T | Promise<T>): Promise<T> {
  return tenantAls.run({ tenantId: 't1', userId: 'u1', roles: ['USER'] }, fn);
}

function mockPrismaForStore() {
  const task = { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn() };
  const session = { findMany: vi.fn(), findFirst: vi.fn() };
  const retrieval = { findMany: vi.fn(), findFirst: vi.fn() };
  return {
    forTenant: { searchTask: task, searchSession: session, searchRetrieval: retrieval },
    _task: task,
    _session: session,
    _retrieval: retrieval,
  };
}

/** Prisma 任务行（含租户与用户列） */
function prismaRow(over: Record<string, unknown> = {}) {
  return {
    id: 'g1',
    tenantId: 't1',
    userId: 'u1',
    sessionId: 's1',
    type: 'generate',
    status: 'ABORTED',
    progress: 33,
    errorMsg: '连接中断',
    createdAt: new Date(),
    updatedAt: new Date(),
    finishedAt: new Date(),
    ...over,
  };
}

describe('SearchTaskStoreService 续跑窗口（18 批 4：过期引导重新检索）', () => {
  /** 装配 store 并给定任务行 + 快照创建时间 */
  async function listWith(row: Record<string, unknown>, retrievalCreatedAt: Date | null) {
    const m = mockPrismaForStore();
    m._task.findMany.mockResolvedValue([row]);
    m._task.count.mockResolvedValue(1);
    m._session.findMany.mockResolvedValue([{ id: 's1', question: '问题' }]);
    m._retrieval.findMany.mockResolvedValue(
      retrievalCreatedAt ? [{ sessionId: 's1', createdAt: retrievalCreatedAt }] : [],
    );
    const svc = new SearchTaskStoreService(m as any);
    const { items } = await withTenant(() => svc.list({ page: 1, pageSize: 10 }));
    return items[0].resumableSeconds;
  }

  it('快照存在 10 分钟：剩余窗口按 TTL 折算（约 20 分钟）', async () => {
    const left = await listWith(prismaRow(), new Date(Date.now() - 10 * 60 * 1000));
    expect(left).toBeGreaterThan(19 * 60);
    expect(left).toBeLessThanOrEqual(20 * 60);
  });

  it('快照已超 TTL：剩余 0（前端引导重新检索，续跑接口也会拒绝）', async () => {
    const left = await listWith(
      prismaRow(),
      new Date(Date.now() - (RETRIEVAL_TTL_SECONDS + 60) * 1000),
    );
    expect(left).toBe(0);
  });

  it('快照已被清理（无快照行）：剩余 0', async () => {
    expect(await listWith(prismaRow(), null)).toBe(0);
  });

  it('非可续跑态返回 null：已完成 / 生成中 / 检索类任务都不展示续跑提示', async () => {
    const base = new Date(Date.now() - 60 * 1000);
    expect(await listWith(prismaRow({ status: 'DONE' }), base)).toBeNull();
    expect(await listWith(prismaRow({ status: 'GENERATING' }), base)).toBeNull();
    expect(await listWith(prismaRow({ type: 'retrieval', status: 'RETRIEVAL_FAILED' }), base)).toBeNull();
  });

  it('GENERATE_FAILED 同样可续跑并返回窗口', async () => {
    const left = await listWith(
      prismaRow({ status: 'GENERATE_FAILED' }),
      new Date(Date.now() - 5 * 60 * 1000),
    );
    expect(left).toBeGreaterThan(24 * 60);
  });
});
