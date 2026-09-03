import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getTenantContext } from '../../common/auth/tenant-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import { parsePageParams, buildPageResult } from './pagination';
import type { AdminBackupPolicy } from './dto';

const execFileAsync = promisify(execFile);

/** 备份策略默认值（与 seed-admin 的 sys_configs 种子一致） */
export const BACKUP_POLICY_DEFAULTS: AdminBackupPolicy = {
  scope: 'full',
  schedule: 'daily',
  keep: 30,
};

/** 备份策略三项的 sys_configs 展示名（键缺失时 upsert 补齐用） */
const BACKUP_CONFIG_META: Record<keyof AdminBackupPolicy, string> = {
  scope: '备份范围',
  schedule: '备份计划',
  keep: '备份保留天数',
};

/** 配置值（lowercase）→ 备份范围枚举映射 */
const SCOPE_ENUM_MAP: Record<string, 'FULL' | 'DATA' | 'CONFIG'> = {
  full: 'FULL',
  data: 'DATA',
  config: 'CONFIG',
};

/**
 * 生成任务编号（纯函数，供单测）：前缀-日期-当日序号，如 BK-20260829-001。
 * @param prefix 任务前缀（BK=备份）
 * @param date 日期
 * @param seq 当日序号（从 1 开始）
 */
export function buildTaskNo(prefix: string, date: Date, seq: number): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${prefix}-${y}${m}${d}-${String(seq).padStart(3, '0')}`;
}

/**
 * 备份/恢复命令执行器抽象：生产走 docker exec 容器内 pg_dump/pg_restore，
 * 单测注入内存 mock，避免真实落盘与依赖 Docker。
 */
export interface BackupCommandRunner {
  run(command: string, args: string[]): Promise<{ stdout: Buffer; stderr: string }>;
}

/** docker exec 默认实现：stdout 保持 Buffer（pg_dump -Fc 为二进制） */
@Injectable()
export class DockerCommandRunner implements BackupCommandRunner {
  async run(command: string, args: string[]): Promise<{ stdout: Buffer; stderr: string }> {
    const { stdout, stderr } = await execFileAsync(command, args, {
      maxBuffer: 1024 * 1024 * 1024, // 1GB，容纳完整库备份
      encoding: 'buffer',
    });
    return { stdout: stdout as Buffer, stderr: (stderr as Buffer).toString('utf8') };
  }
}

/**
 * 系统管理 · 备份恢复服务（A-15，M7.4 起真实执行）。
 * backupNow：docker exec 容器内 pg_dump -Fc 落 backups/ 目录，记录 filePath/sizeBytes，
 *   失败落 FAILED 记录（不抛出，供管理端展示）；成功后按 keep 天数清理过期备份文件。
 */
@Injectable()
export class AdminBackupService {
  private readonly logger = new Logger(AdminBackupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly runner: DockerCommandRunner,
  ) {}

  /** 备份策略（存 sys_configs，缺失项回退默认值） */
  async getPolicy(): Promise<AdminBackupPolicy> {
    const rows = await this.prisma.sysConfig.findMany({
      where: { key: { in: ['backup.scope', 'backup.schedule', 'backup.keep'] } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const scope = map.get('backup.scope');
    const schedule = map.get('backup.schedule');
    const keep = Number(map.get('backup.keep'));
    return {
      scope: scope === 'data' || scope === 'config' ? scope : BACKUP_POLICY_DEFAULTS.scope,
      schedule: schedule === 'weekly' || schedule === 'monthly' ? schedule : BACKUP_POLICY_DEFAULTS.schedule,
      keep: Number.isInteger(keep) && keep >= 1 && keep <= 365 ? keep : BACKUP_POLICY_DEFAULTS.keep,
    };
  }

  /** 保存备份策略（三项写回 sys_configs） */
  async updatePolicy(input: AdminBackupPolicy): Promise<AdminBackupPolicy> {
    const operatorId = getTenantContext()?.userId ?? null;
    const values: Array<{ key: keyof AdminBackupPolicy; value: string }> = [
      { key: 'scope', value: input.scope },
      { key: 'schedule', value: input.schedule },
      { key: 'keep', value: String(input.keep) },
    ];
    for (const { key, value } of values) {
      const configKey = `backup.${key}`;
      await this.prisma.sysConfig.upsert({
        where: { key: configKey },
        create: { key: configKey, value, label: BACKUP_CONFIG_META[key], updatedBy: operatorId },
        update: { value, updatedBy: operatorId },
      });
    }
    this.logger.log(`管理端更新备份策略: scope=${input.scope} schedule=${input.schedule} keep=${input.keep}`);
    return this.getPolicy();
  }

  /** 立即备份：真实执行 pg_dump 落盘；失败落 FAILED 记录不抛出 */
  async backupNow() {
    const policy = await this.getPolicy();
    const operatorId = getTenantContext()?.userId ?? null;
    const taskNo = await this.genTaskNo();
    const scope = SCOPE_ENUM_MAP[policy.scope] ?? 'FULL';

    const dir = this.backupDir();
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${taskNo}.dump`);

    try {
      const { stdout } = await this.runner.run('docker', [
        'exec',
        this.pgContainer(),
        'pg_dump',
        '-U', this.pgUser(),
        '-d', this.pgDb(),
        '-Fc',
      ]);
      await writeFile(filePath, stdout);
      const sizeMb = (stdout.length / 1024 / 1024).toFixed(2);

      const [record] = await this.prisma.$transaction([
        this.prisma.sysTask.create({
          data: {
            taskNo, type: 'BACKUP', status: 'SUCCESS', progress: 100, stage: '完成',
            userId: operatorId, payload: { scope: policy.scope, mode: 'manual' },
          },
        }),
        this.prisma.backupRecord.create({
          data: {
            scope, type: 'BACKUP', status: 'SUCCESS', sizeBytes: stdout.length,
            filePath, message: `备份完成（${sizeMb}MB）`, operatorId,
          },
        }),
      ]);
      await this.cleanupOldBackups(policy.keep);
      this.logger.log(`真实备份完成: taskNo=${taskNo} size=${sizeMb}MB`);
      return record;
    } catch (err) {
      const reason = (err as Error).message;
      this.logger.error(`备份失败: ${reason}`);
      // 失败也落记录，供管理端展示失败原因，避免接口 500
      const [record] = await this.prisma.$transaction([
        this.prisma.sysTask.create({
          data: {
            taskNo, type: 'BACKUP', status: 'FAILED', progress: 0, stage: '失败',
            userId: operatorId, payload: { scope: policy.scope, mode: 'manual' },
          },
        }),
        this.prisma.backupRecord.create({
          data: { scope, type: 'BACKUP', status: 'FAILED', message: `备份失败: ${reason}`.slice(0, 500), operatorId },
        }),
      ]);
      return record;
    }
  }

  /** 备份记录（时间倒序 + 分页） */
  async listRecords(query: { page: number; pageSize: number }) {
    const params = parsePageParams(String(query.page), String(query.pageSize));
    const [total, rows] = await Promise.all([
      this.prisma.backupRecord.count(),
      this.prisma.backupRecord.findMany({
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
    ]);
    return buildPageResult(rows, total, params);
  }

  /** 恢复备份（二次确认 + 审计；真实恢复演练由 scripts/backup-restore-drill.mjs 执行） */
  async restore(id: string) {
    const record = await this.prisma.backupRecord.findUnique({ where: { id } });
    if (!record) {
      throw new BizException(ErrorCode.NOT_FOUND, '备份记录不存在', HttpStatus.NOT_FOUND);
    }
    if (record.status !== 'SUCCESS') {
      throw new BizException(ErrorCode.CONFLICT, '仅成功的备份可恢复', HttpStatus.CONFLICT);
    }
    this.logger.log(`管理端触发备份恢复: id=${id}`);
    return { ok: true, id: record.id, scope: record.scope };
  }

  /** 当日备份任务序号（taskNo 唯一，极小概率并发同号追加时间戳兜底） */
  private async genTaskNo(): Promise<string> {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const count = await this.prisma.sysTask.count({ where: { type: 'BACKUP', createdAt: { gte: dayStart } } });
    let taskNo = buildTaskNo('BK', new Date(), count + 1);
    const exists = await this.prisma.sysTask.findUnique({ where: { taskNo } });
    if (exists) taskNo = `${taskNo}-${Date.now()}`;
    return taskNo;
  }

  /** 清理超过 keep 天的过期备份文件（记录保留作审计，仅删磁盘文件） */
  private async cleanupOldBackups(keepDays: number): Promise<void> {
    const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000);
    const old = await this.prisma.backupRecord.findMany({
      where: { type: 'BACKUP', status: 'SUCCESS', filePath: { not: null }, createdAt: { lt: cutoff } },
      select: { id: true, filePath: true },
    });
    for (const r of old) {
      if (r.filePath) {
        await unlink(r.filePath).catch((e) => this.logger.warn(`清理旧备份失败 ${r.id}: ${(e as Error).message}`));
      }
    }
    if (old.length) this.logger.log(`清理过期备份文件 ${old.length} 份（保留 ${keepDays} 天）`);
  }

  private backupDir(): string {
    return this.config.get<string>('BACKUP_DIR', path.resolve(process.cwd(), 'backups'));
  }
  private pgContainer(): string {
    return this.config.get<string>('BACKUP_PG_CONTAINER', 'ai-postgres');
  }
  private pgUser(): string {
    return this.config.get<string>('BACKUP_PG_USER', 'postgres');
  }
  private pgDb(): string {
    return this.config.get<string>('BACKUP_PG_DB', 'ai_research');
  }
}
