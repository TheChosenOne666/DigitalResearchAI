import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthService } from '../../common/health/health.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TASK_TYPE_TEXT } from './constants';
import { parsePageParams, buildPageResult } from './pagination';

/** 错误日志合并时单来源最大拉取条数（内存合并后分页） */
export const ERROR_SOURCE_LIMIT = 200;

/** 监控服务行（A-14 服务健康看板） */
export interface MonitorServiceRow {
  key: string;
  name: string;
  address: string;
  status: 'up' | 'down';
}

/** 错误日志行（任务 ERROR + 平台级安全事件） */
export interface MonitorErrorRow {
  time: Date;
  /** 来源：task=后台任务日志 / sensitive=敏感词拦截 */
  source: 'task' | 'sensitive';
  /** 服务名（检索任务 / 敏感词拦截…） */
  service: string;
  message: string;
}

/** 从连接串提取 host:port（脱敏，不含账号密码），解析失败回退默认值 */
function describeUrl(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  try {
    const u = new URL(raw);
    return u.host || fallback;
  } catch {
    return fallback;
  }
}

/**
 * 合并两来源错误日志并按时间倒序排序（纯函数，供单测；分页与关键词过滤由调用方处理）。
 * @param taskLogs 任务 ERROR 日志（已含 task.type）
 * @param blocked 敏感词拦截审计（SEARCH_BLOCKED）
 */
export function mergeErrorRows(
  taskLogs: Array<{ createdAt: Date; message: string; task: { type: string } }>,
  blocked: Array<{ createdAt: Date; detail: unknown }>,
): MonitorErrorRow[] {
  const taskRows: MonitorErrorRow[] = taskLogs.map((r) => ({
    time: r.createdAt,
    source: 'task' as const,
    service: `${TASK_TYPE_TEXT[r.task.type] ?? r.task.type}任务`,
    message: r.message,
  }));
  const blockedRows: MonitorErrorRow[] = blocked.map((r) => {
    const detail = r.detail as { word?: string; question?: string } | null;
    return {
      time: r.createdAt,
      source: 'sensitive' as const,
      service: '敏感词拦截',
      message: detail?.word ? `命中敏感词「${detail.word}」，已拦截检索：${detail.question ?? ''}` : '命中敏感词，已拦截该次检索',
    };
  });
  return [...taskRows, ...blockedRows].sort(
    (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime(),
  );
}

/**
 * 系统管理 · 运行监控服务（A-14）。
 * 健康探测复用 HealthService 真实探测（D5：PG/Redis/Qdrant + API 自身）；
 * 错误日志 = 任务日志 ERROR + 平台级安全事件（敏感词拦截）。
 */
@Injectable()
export class AdminMonitorService {
  private readonly logger = new Logger(AdminMonitorService.name);

  constructor(
    private readonly health: HealthService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /** 服务健康状态（真实探测） */
  async healthStatus() {
    const result = await this.health.check(true);
    const checks = result.checks ?? { postgres: 'down' as const, redis: 'down' as const, qdrant: 'down' as const };
    const services: MonitorServiceRow[] = [
      { key: 'api', name: '后端 API', address: '本服务进程', status: 'up' },
      {
        key: 'postgres',
        name: '数据库 PostgreSQL',
        address: describeUrl(this.config.get<string>('DATABASE_URL'), 'localhost:5432'),
        status: checks.postgres,
      },
      {
        key: 'redis',
        name: 'Redis',
        address: describeUrl(this.config.get<string>('REDIS_URL'), 'localhost:6379'),
        status: checks.redis,
      },
      {
        key: 'qdrant',
        name: '向量服务 Qdrant',
        address: describeUrl(this.config.get<string>('QDRANT_URL'), 'localhost:6333'),
        status: checks.qdrant,
      },
    ];
    return {
      checkedAt: new Date().toISOString(),
      uptime: result.uptime,
      version: result.version,
      services,
    };
  }

  /** 错误日志（source=all|task|sensitive + 关键词 + 分页） */
  async errors(query: { source?: string; keyword?: string; page: number; pageSize: number }) {
    const source = query.source === 'task' || query.source === 'sensitive' ? query.source : 'all';
    const keyword = query.keyword?.trim();
    const [taskLogs, blocked] = await Promise.all([
      source === 'sensitive'
        ? []
        : this.prisma.taskLog.findMany({
            where: { level: 'ERROR' },
            orderBy: { createdAt: 'desc' },
            take: ERROR_SOURCE_LIMIT,
            include: { task: { select: { type: true } } },
          }),
      source === 'task'
        ? []
        : this.prisma.auditLog.findMany({
            where: { action: 'SEARCH_BLOCKED' },
            orderBy: { createdAt: 'desc' },
            take: ERROR_SOURCE_LIMIT,
          }),
    ]);
    const merged = mergeErrorRows(taskLogs, blocked);
    const filtered = keyword
      ? merged.filter((r) => r.message.includes(keyword) || r.service.includes(keyword))
      : merged;
    const params = parsePageParams(String(query.page), String(query.pageSize));
    return buildPageResult(filtered.slice(params.skip, params.skip + params.take), filtered.length, params);
  }
}
