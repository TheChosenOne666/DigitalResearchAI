import { describe, expect, it, vi } from 'vitest';
import { AdminConfigsService, validateConfigValue } from '../src/modules/admin/configs.service';
import { AdminAuditService } from '../src/modules/admin/admin-audit.service';
import { AdminMonitorService, mergeErrorRows } from '../src/modules/admin/monitor.service';
import { AdminBackupService, buildTaskNo } from '../src/modules/admin/backup.service';
import { ErrorCode } from '@app/shared';

// M7.4 backupNow 真实执行会写 backups/ 目录，单测 mock 掉 fs 避免真实落盘
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

describe('AdminConfigsService（参数配置 A-12）', () => {
  it('validateConfigValue：各参数范围校验', () => {
    expect(validateConfigValue('upload.maxSizeMb', '200')).toBeNull();
    expect(validateConfigValue('upload.maxSizeMb', 'abc')).not.toBeNull();
    expect(validateConfigValue('upload.maxSizeMb', '0')).not.toBeNull();
    expect(validateConfigValue('upload.maxSizeMb', '2048')).not.toBeNull();
    expect(validateConfigValue('list.pageSize', '50')).toBeNull();
    expect(validateConfigValue('list.pageSize', '500')).not.toBeNull();
    expect(validateConfigValue('kb.matchThreshold', '0.8')).toBeNull();
    expect(validateConfigValue('kb.matchThreshold', '1.5')).not.toBeNull();
    expect(validateConfigValue('backup.schedule', 'weekly')).toBeNull();
    expect(validateConfigValue('backup.schedule', 'hourly')).not.toBeNull();
  });

  it('update 合法值写库并记录修改人', async () => {
    const prisma = {
      sysConfig: {
        findUnique: vi.fn().mockResolvedValue({ key: 'upload.maxSizeMb', value: '100' }),
        update: vi.fn().mockResolvedValue({ key: 'upload.maxSizeMb', value: '200' }),
      },
    };
    const svc = new AdminConfigsService(prisma as never);
    const row = await svc.update('upload.maxSizeMb', '200');
    expect(row.value).toBe('200');
    expect(prisma.sysConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ value: '200' }) }),
    );
  });

  it('update 范围外值 → VALIDATION_FAILED', async () => {
    const prisma = {
      sysConfig: {
        findUnique: vi.fn().mockResolvedValue({ key: 'list.pageSize', value: '20' }),
        update: vi.fn(),
      },
    };
    const svc = new AdminConfigsService(prisma as never);
    await expect(svc.update('list.pageSize', '999')).rejects.toMatchObject({
      bizCode: ErrorCode.VALIDATION_FAILED,
    });
    expect(prisma.sysConfig.update).not.toHaveBeenCalled();
  });

  it('update key 不存在 → NOT_FOUND', async () => {
    const svc = new AdminConfigsService({ sysConfig: { findUnique: vi.fn().mockResolvedValue(null) } } as never);
    await expect(svc.update('nope.key', '1')).rejects.toMatchObject({ bizCode: ErrorCode.NOT_FOUND });
  });
});

describe('AdminAuditService.query（审计查询 A-13）', () => {
  function buildPrisma(total: number, rows: unknown[] = []) {
    return {
      auditLog: {
        create: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(total),
        findMany: vi.fn().mockResolvedValue(rows),
      },
    };
  }

  it('tab 映射为动作（login→LOGIN）并按时间窗口过滤', async () => {
    const prisma = buildPrisma(0);
    const svc = new AdminAuditService(prisma as never);
    await svc.query({ tab: 'export', days: 30, page: 1, pageSize: 20 });
    expect(prisma.auditLog.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          action: 'EXPORT',
          createdAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      }),
    );
  });

  it('非法 tab 回退 login；result=fail 过滤 detail.success=false', async () => {
    const prisma = buildPrisma(0);
    const svc = new AdminAuditService(prisma as never);
    await svc.query({ tab: 'unknown', result: 'fail', page: 1, pageSize: 20 });
    const arg = prisma.auditLog.count.mock.calls[0][0];
    expect(arg.where.action).toBe('LOGIN');
    expect(arg.where.detail).toEqual({ path: ['success'], equals: false });
  });

  it('返回组装后的用户展示名与结果标记', async () => {
    const row = {
      id: 'a1',
      action: 'LOGIN',
      userId: 'u1',
      user: { id: 'u1', username: 'admin', realName: null, nickname: '管理员', phone: '13800000000' },
      ip: '192.168.1.12',
      detail: { method: 'password' },
      createdAt: new Date(),
    };
    const svc = new AdminAuditService(buildPrisma(1, [row]) as never);
    const res = await svc.query({ tab: 'login', page: 1, pageSize: 20 });
    expect(res.list[0].user).toBe('admin');
    expect(res.list[0].success).toBe(true);
  });
});

describe('AdminMonitorService（运行监控 A-14）', () => {
  it('mergeErrorRows：合并排序 + 敏感词详情拼装', () => {
    const t1 = { createdAt: new Date('2026-08-29T10:00:00Z'), message: '连接超时', task: { type: 'SEARCH' } };
    const t2 = { createdAt: new Date('2026-08-29T11:00:00Z'), message: '索引失败', task: { type: 'INDEX' } };
    const b1 = { createdAt: new Date('2026-08-29T09:30:00Z'), detail: { word: '违法词', question: '如何造假' } };
    const merged = mergeErrorRows([t1, t2], [b1]);
    expect(merged).toHaveLength(3);
    expect(merged[0].service).toBe('索引任务');
    expect(merged[2].source).toBe('sensitive');
    expect(merged[2].message).toContain('违法词');
  });

  it('healthStatus 返回四服务探测结果', async () => {
    const svc = new AdminMonitorService(
      { check: vi.fn().mockResolvedValue({ status: 'ok', uptime: 100, version: '0.1.0', checks: { postgres: 'up', redis: 'up', qdrant: 'down' } }) } as never,
      { get: vi.fn().mockReturnValue(undefined) } as never,
      {} as never,
    );
    const res = await svc.healthStatus();
    expect(res.services).toHaveLength(4);
    expect(res.services.find((s) => s.key === 'api')?.status).toBe('up');
    expect(res.services.find((s) => s.key === 'qdrant')?.status).toBe('down');
  });

  it('errors 合并任务 ERROR 与敏感词拦截并支持关键词过滤', async () => {
    const prisma = {
      taskLog: {
        findMany: vi.fn().mockResolvedValue([
          { createdAt: new Date('2026-08-29T10:00:00Z'), message: '数据源连接超时', task: { type: 'SEARCH' } },
        ]),
      },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([
          { createdAt: new Date('2026-08-29T09:00:00Z'), detail: { word: '违禁词', question: 'x' } },
        ]),
      },
    };
    const svc = new AdminMonitorService(
      { check: vi.fn() } as never,
      { get: vi.fn() } as never,
      prisma as never,
    );
    const all = await svc.errors({ page: 1, pageSize: 20 });
    expect(all.total).toBe(2);
    const filtered = await svc.errors({ keyword: '超时', page: 1, pageSize: 20 });
    expect(filtered.total).toBe(1);
    expect(filtered.list[0].service).toBe('检索任务');
  });
});

describe('AdminBackupService（数据备份 A-15）', () => {
  function buildPrisma(overrides: Record<string, unknown> = {}) {
    return {
      sysConfig: {
        findMany: vi.fn().mockResolvedValue([
          { key: 'backup.scope', value: 'full' },
          { key: 'backup.schedule', value: 'daily' },
          { key: 'backup.keep', value: '30' },
        ]),
        upsert: vi.fn().mockResolvedValue(null),
      },
      sysTask: {
        count: vi.fn().mockResolvedValue(0),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'st1', taskNo: 'BK-20260829-001' }),
      },
      backupRecord: {
        create: vi.fn().mockResolvedValue({ id: 'b1', scope: 'FULL', status: 'SUCCESS' }),
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn().mockResolvedValue([{ id: 'b1' }]),
      ...overrides,
    };
  }

  // M7.4 构造辅助：ConfigService 返回默认值 + runner 返回假 dump buffer（不真实连 Docker）
  const mockConfig = { get: (_k: string, d?: string) => d } as never;
  const makeRunner = (over: { stdout?: Buffer; fail?: boolean } = {}) =>
    ({
      run: vi.fn().mockImplementation(async () => {
        if (over.fail) throw new Error('pg_dump failed');
        return { stdout: over.stdout ?? Buffer.from('dump-bytes'), stderr: '' };
      }),
    }) as never;
  const makeSvc = (prisma: unknown, runnerOver: { stdout?: Buffer; fail?: boolean } = {}) =>
    new AdminBackupService(prisma as never, mockConfig, makeRunner(runnerOver));

  it('buildTaskNo 生成当日序号编号', () => {
    expect(buildTaskNo('BK', new Date(2026, 7, 29), 1)).toBe('BK-20260829-001');
    expect(buildTaskNo('BK', new Date(2026, 11, 5), 12)).toBe('BK-20261205-012');
  });

  it('getPolicy 缺失配置回退默认值', async () => {
    const prisma = buildPrisma({ sysConfig: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn() } });
    const svc = makeSvc(prisma);
    const policy = await svc.getPolicy();
    expect(policy).toEqual({ scope: 'full', schedule: 'daily', keep: 30 });
  });

  it('updatePolicy 三项写回 sys_configs', async () => {
    const store = new Map([
      ['backup.scope', 'full'],
      ['backup.schedule', 'daily'],
      ['backup.keep', '30'],
    ]);
    const prisma = {
      sysConfig: {
        findMany: vi.fn(async () => [...store.entries()].map(([key, value]) => ({ key, value }))),
        upsert: vi.fn(async ({ where, create }: { where: { key: string }; create: { value: string } }) => {
          store.set(where.key, create.value);
          return {};
        }),
      },
    };
    const svc = makeSvc(prisma);
    const policy = await svc.updatePolicy({ scope: 'data', schedule: 'weekly', keep: 7 });
    expect(policy.scope).toBe('data');
    expect(policy.schedule).toBe('weekly');
    expect(policy.keep).toBe(7);
    expect(prisma.sysConfig.upsert).toHaveBeenCalledTimes(3);
  });

  it('backupNow 落 sys_tasks(BACKUP) + backup_records', async () => {
    const prisma = buildPrisma();
    const svc = makeSvc(prisma);
    await svc.backupNow();
    expect(prisma.sysTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'BACKUP', status: 'SUCCESS', progress: 100 }),
      }),
    );
    expect(prisma.backupRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ scope: 'FULL', status: 'SUCCESS' }),
      }),
    );
  });

  it('restore 仅成功备份可恢复；失败备份 → CONFLICT', async () => {
    const prisma = buildPrisma({
      backupRecord: {
        ...buildPrisma().backupRecord,
        findUnique: vi.fn().mockResolvedValue({ id: 'b1', status: 'FAILED' }),
      },
    });
    const svc = makeSvc(prisma);
    await expect(svc.restore('b1')).rejects.toMatchObject({ bizCode: ErrorCode.CONFLICT });
  });

  it('restore 成功备份返回 ok', async () => {
    const prisma = buildPrisma({
      backupRecord: {
        ...buildPrisma().backupRecord,
        findUnique: vi.fn().mockResolvedValue({ id: 'b1', status: 'SUCCESS', scope: 'FULL' }),
      },
    });
    const svc = makeSvc(prisma);
    const res = await svc.restore('b1');
    expect(res.ok).toBe(true);
  });
});
