import { describe, expect, it, vi } from 'vitest';
import { AdminTasksService, TASK_RETRY_LIMIT } from '../src/modules/admin/tasks.service';
import { ErrorCode } from '@app/shared';

describe('AdminTasksService（任务中心 A-11）', () => {
  function buildPrisma(overrides: Record<string, unknown> = {}) {
    return {
      sysTask: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue(null),
      },
      taskLog: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue(null),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      ...overrides,
    };
  }

  const failedTask = {
    id: 't1',
    taskNo: 'T-20260829-001',
    type: 'SEARCH',
    userId: 'u1',
    status: 'FAILED',
    progress: 0,
    stage: null,
    errorLog: '数据源连接超时',
    retryCount: 1,
    createdAt: new Date('2026-08-29T09:00:00Z'),
    updatedAt: new Date('2026-08-29T09:01:00Z'),
  };

  it('list 按 type/status 筛选并组装用户展示名', async () => {
    const prisma = buildPrisma({
      sysTask: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([failedTask]),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'u1', username: 'li_research', realName: '李研究', nickname: '李研究', phone: '13900000001' }]),
      },
    });
    const svc = new AdminTasksService(prisma as never);
    const res = await svc.list({ type: 'SEARCH', status: 'FAILED', keyword: '', page: 1, pageSize: 20 });
    expect(res.total).toBe(1);
    expect(res.list[0].user).toBe('li_research');
    expect(res.list[0].retryCount).toBe(1);
    expect(prisma.sysTask.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ type: 'SEARCH', status: 'FAILED' }) }),
    );
  });

  it('list 关键词跨任务编号与用户反查', async () => {
    const prisma = buildPrisma();
    const svc = new AdminTasksService(prisma as never);
    await svc.list({ keyword: 'li_research', page: 1, pageSize: 20 });
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ OR: expect.any(Array) }) }),
    );
    expect(prisma.sysTask.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ OR: expect.any(Array) }) }),
    );
  });

  it('重试失败任务 → WAITING + retryCount+1 + 写任务日志', async () => {
    const prisma = buildPrisma({
      sysTask: {
        ...buildPrisma().sysTask,
        findUnique: vi.fn().mockResolvedValue(failedTask),
        update: vi.fn().mockResolvedValue({ ...failedTask, status: 'WAITING', retryCount: 2 }),
      },
    });
    const svc = new AdminTasksService(prisma as never);
    const row = await svc.retry('t1');
    expect(row.status).toBe('WAITING');
    expect(row.retryCount).toBe(2);
    expect(prisma.sysTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'WAITING', progress: 0, retryCount: { increment: 1 } }),
      }),
    );
    expect(prisma.taskLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ taskId: 't1', level: 'INFO' }) }),
    );
  });

  it('非失败任务重试 → CONFLICT', async () => {
    const prisma = buildPrisma({
      sysTask: { ...buildPrisma().sysTask, findUnique: vi.fn().mockResolvedValue({ ...failedTask, status: 'SUCCESS' }) },
    });
    const svc = new AdminTasksService(prisma as never);
    await expect(svc.retry('t1')).rejects.toMatchObject({ bizCode: ErrorCode.CONFLICT });
  });

  it(`重试次数达到上限（${TASK_RETRY_LIMIT}）→ CONFLICT`, async () => {
    const prisma = buildPrisma({
      sysTask: { ...buildPrisma().sysTask, findUnique: vi.fn().mockResolvedValue({ ...failedTask, retryCount: TASK_RETRY_LIMIT }) },
    });
    const svc = new AdminTasksService(prisma as never);
    await expect(svc.retry('t1')).rejects.toMatchObject({ bizCode: ErrorCode.CONFLICT });
  });

  it('终止执行中任务 → STOPPED + 写 WARN 日志', async () => {
    const running = { ...failedTask, status: 'RUNNING', progress: 72, stage: '标准化阶段' };
    const prisma = buildPrisma({
      sysTask: { ...buildPrisma().sysTask, findUnique: vi.fn().mockResolvedValue(running), update: vi.fn().mockResolvedValue({ ...running, status: 'STOPPED' }) },
    });
    const svc = new AdminTasksService(prisma as never);
    const row = await svc.stop('t1');
    expect(row.status).toBe('STOPPED');
    expect(prisma.taskLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ level: 'WARN' }) }),
    );
  });

  it('成功任务终止 → CONFLICT', async () => {
    const prisma = buildPrisma({
      sysTask: { ...buildPrisma().sysTask, findUnique: vi.fn().mockResolvedValue({ ...failedTask, status: 'SUCCESS' }) },
    });
    const svc = new AdminTasksService(prisma as never);
    await expect(svc.stop('t1')).rejects.toMatchObject({ bizCode: ErrorCode.CONFLICT });
  });

  it('任务不存在（重试/终止/日志）→ NOT_FOUND', async () => {
    const svc = new AdminTasksService(buildPrisma() as never);
    await expect(svc.retry('nope')).rejects.toMatchObject({ bizCode: ErrorCode.NOT_FOUND });
    await expect(svc.stop('nope')).rejects.toMatchObject({ bizCode: ErrorCode.NOT_FOUND });
    await expect(svc.logs('nope')).rejects.toMatchObject({ bizCode: ErrorCode.NOT_FOUND });
  });

  it('日志按时间正序返回', async () => {
    const prisma = buildPrisma({
      sysTask: { ...buildPrisma().sysTask, findUnique: vi.fn().mockResolvedValue(failedTask) },
      taskLog: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'l1', level: 'WARN', message: '映射缺失字段', createdAt: new Date() },
          { id: 'l2', level: 'ERROR', message: '连接超时', createdAt: new Date() },
        ]),
      },
    });
    const svc = new AdminTasksService(prisma as never);
    const res = await svc.logs('t1');
    expect(res.task.taskNo).toBe('T-20260829-001');
    expect(res.logs).toHaveLength(2);
    expect(prisma.taskLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'asc' } }),
    );
  });
});
