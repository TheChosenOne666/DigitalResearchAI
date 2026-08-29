import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { getTenantContext } from '../../common/auth/tenant-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import { parsePageParams, buildPageResult } from './pagination';
import type { AdminBackupPolicy } from './dto';

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
 * 系统管理 · 备份恢复服务（A-15）。
 * D5：演示环境仅落 backup_records 与 sys_tasks（BACKUP）记录，不调用 pg_dump 真实备份；
 * 恢复操作仅二次确认 + 审计，不真执行。
 */
@Injectable()
export class AdminBackupService {
  private readonly logger = new Logger(AdminBackupService.name);

  constructor(private readonly prisma: PrismaService) {}

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

  /** 立即备份：落 backup_records + sys_tasks（BACKUP/SUCCESS）记录，不执行真实备份（D5） */
  async backupNow() {
    const policy = await this.getPolicy();
    const operatorId = getTenantContext()?.userId ?? null;
    // 当日备份任务序号（taskNo 唯一）
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const count = await this.prisma.sysTask.count({
      where: { type: 'BACKUP', createdAt: { gte: dayStart } },
    });
    let taskNo = buildTaskNo('BK', new Date(), count + 1);
    // 极小概率并发同号：追加时间戳后缀兜底
    const exists = await this.prisma.sysTask.findUnique({ where: { taskNo } });
    if (exists) {
      taskNo = `${taskNo}-${Date.now()}`;
    }
    const [record] = await this.prisma.$transaction([
      this.prisma.sysTask.create({
        data: {
          taskNo,
          type: 'BACKUP',
          status: 'SUCCESS',
          progress: 100,
          stage: '完成',
          userId: operatorId,
          payload: { scope: policy.scope, schedule: policy.schedule, mode: 'manual' },
        },
      }),
      this.prisma.backupRecord.create({
        data: {
          scope: SCOPE_ENUM_MAP[policy.scope] ?? 'FULL',
          status: 'SUCCESS',
          message: '演示环境：仅记录备份任务，未执行真实备份',
          operatorId,
        },
      }),
    ]);
    this.logger.log(`管理端立即备份: taskNo=${taskNo} scope=${policy.scope}`);
    return record;
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

  /** 恢复备份（D5：不真执行，仅二次确认 + 审计） */
  async restore(id: string) {
    const record = await this.prisma.backupRecord.findUnique({ where: { id } });
    if (!record) {
      throw new BizException(ErrorCode.NOT_FOUND, '备份记录不存在', HttpStatus.NOT_FOUND);
    }
    if (record.status !== 'SUCCESS') {
      throw new BizException(ErrorCode.CONFLICT, '仅成功的备份可恢复', HttpStatus.CONFLICT);
    }
    this.logger.log(`管理端触发备份恢复: id=${id}（演示环境不执行真实恢复）`);
    return { ok: true, id: record.id, scope: record.scope };
  }
}
