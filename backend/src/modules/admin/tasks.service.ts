import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import { Prisma } from '../../generated/prisma/client';
import { parsePageParams, buildPageResult } from './pagination';

/** 任务重试上限（A-11：与用户端 U-04 状态机一致） */
export const TASK_RETRY_LIMIT = 3;

/** 任务列表筛选条件 */
export interface AdminTaskQuery {
  type?: string;
  status?: string;
  keyword?: string;
  page: number;
  pageSize: number;
}

const TASK_TYPES = ['SEARCH', 'COLLECT', 'ANALYZE', 'REPORT', 'INDEX', 'BACKUP'] as const;
const TASK_STATUSES = ['WAITING', 'RUNNING', 'SUCCESS', 'FAILED', 'STOPPED'] as const;

/**
 * 任务中心 · 后台任务监控服务（A-11）。
 * 跨租户查询 sys_tasks（检索/采集/分析/报告/索引/备份任务共用），支持重试/终止/日志；
 * 演示环境任务由数据准备脚本与备份功能写入，管理端只做状态机操作，不执行真实任务。
 */
@Injectable()
export class AdminTasksService {
  private readonly logger = new Logger(AdminTasksService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 任务列表（类型/状态筛选 + 关键词跨任务编号/用户 + 分页，最新在前） */
  async list(query: AdminTaskQuery) {
    const where: Prisma.SysTaskWhereInput = {};
    if ((TASK_TYPES as readonly string[]).includes(query.type ?? '')) {
      where.type = query.type as (typeof TASK_TYPES)[number];
    }
    if ((TASK_STATUSES as readonly string[]).includes(query.status ?? '')) {
      where.status = query.status as (typeof TASK_STATUSES)[number];
    }
    const keyword = query.keyword?.trim();
    if (keyword) {
      // keyword 匹配任务编号或用户展示名（userId 无 FK relation，先反查用户 ID）
      const users = await this.prisma.user.findMany({
        where: {
          OR: [
            { username: { contains: keyword } },
            { realName: { contains: keyword } },
            { nickname: { contains: keyword } },
            { phone: { contains: keyword } },
          ],
        },
        select: { id: true },
      });
      where.OR = [{ taskNo: { contains: keyword } }, { userId: { in: users.map((u) => u.id) } }];
    }
    const params = parsePageParams(String(query.page), String(query.pageSize));
    const [total, rows] = await Promise.all([
      this.prisma.sysTask.count({ where }),
      this.prisma.sysTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
    ]);
    // 手动批量组装用户展示名（userId 无 FK relation，跨租户直查）
    const userIds = [...new Set(rows.map((r) => r.userId).filter((v): v is string => Boolean(v)))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, username: true, realName: true, nickname: true, phone: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u.username ?? u.realName ?? u.nickname ?? u.phone]));
    return buildPageResult(
      rows.map((r) => ({
        id: r.id,
        taskNo: r.taskNo,
        type: r.type,
        userId: r.userId,
        user: r.userId ? (userMap.get(r.userId) ?? null) : null,
        status: r.status,
        progress: r.progress,
        stage: r.stage,
        errorLog: r.errorLog,
        retryCount: r.retryCount,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
      total,
      params,
    );
  }

  /** 重试失败任务（重试上限 3 次，重置状态机重新入队） */
  async retry(id: string) {
    const task = await this.prisma.sysTask.findUnique({ where: { id } });
    if (!task) {
      throw new BizException(ErrorCode.NOT_FOUND, '任务不存在', HttpStatus.NOT_FOUND);
    }
    if (task.status !== 'FAILED') {
      throw new BizException(ErrorCode.CONFLICT, '仅失败任务可重试', HttpStatus.CONFLICT);
    }
    if (task.retryCount >= TASK_RETRY_LIMIT) {
      throw new BizException(ErrorCode.CONFLICT, `已达重试上限（${TASK_RETRY_LIMIT} 次）`, HttpStatus.CONFLICT);
    }
    const row = await this.prisma.sysTask.update({
      where: { id },
      data: {
        status: 'WAITING',
        progress: 0,
        stage: null,
        errorLog: null,
        retryCount: { increment: 1 },
      },
    });
    await this.prisma.taskLog.create({
      data: { taskId: id, level: 'INFO', message: '管理员触发重试，任务重新入队' },
    });
    this.logger.log(`管理端重试任务: id=${id} retryCount=${row.retryCount}`);
    return row;
  }

  /** 终止待执行/执行中任务（不可逆，前端二次确认） */
  async stop(id: string) {
    const task = await this.prisma.sysTask.findUnique({ where: { id } });
    if (!task) {
      throw new BizException(ErrorCode.NOT_FOUND, '任务不存在', HttpStatus.NOT_FOUND);
    }
    if (task.status !== 'WAITING' && task.status !== 'RUNNING') {
      throw new BizException(ErrorCode.CONFLICT, '仅待执行/执行中任务可终止', HttpStatus.CONFLICT);
    }
    const row = await this.prisma.sysTask.update({
      where: { id },
      data: { status: 'STOPPED', stage: '已终止' },
    });
    await this.prisma.taskLog.create({
      data: { taskId: id, level: 'WARN', message: '管理员手动终止任务' },
    });
    this.logger.log(`管理端终止任务: id=${id}`);
    return row;
  }

  /** 任务日志（时间正序，含任务基本信息） */
  async logs(id: string) {
    const task = await this.prisma.sysTask.findUnique({ where: { id } });
    if (!task) {
      throw new BizException(ErrorCode.NOT_FOUND, '任务不存在', HttpStatus.NOT_FOUND);
    }
    const logs = await this.prisma.taskLog.findMany({
      where: { taskId: id },
      orderBy: { createdAt: 'asc' },
    });
    return {
      task: {
        id: task.id,
        taskNo: task.taskNo,
        type: task.type,
        status: task.status,
        progress: task.progress,
        stage: task.stage,
        errorLog: task.errorLog,
        retryCount: task.retryCount,
      },
      logs,
    };
  }
}
