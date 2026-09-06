import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';

/**
 * 知识索引管理服务（A-19）：索引统计（条目/切片/待增量）+ 索引任务登记。
 * D5 演示环境约定：索引任务仅落 sys_tasks 记录（含任务日志），不真改 Qdrant。
 */
@Injectable()
export class KbIndexAdminService {
  private readonly logger = new Logger(KbIndexAdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 索引统计：条目总数/切片总数/待增量（未向量化切片）/上次重建/最近任务 */
  async indexStats() {
    const [readyDocs, totalChunks, pendingChunks, indexTasks] = await Promise.all([
      this.prisma.kbDocument.count({ where: { status: 'READY' } }),
      this.prisma.kbChunk.count(),
      this.prisma.kbChunk.count({ where: { vectorId: null } }),
      this.prisma.sysTask.findMany({
        where: { type: 'INDEX' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);
    const lastRebuild = indexTasks.find(
      (t) => readTaskAction(t.payload) === 'REBUILD' && t.status === 'SUCCESS',
    );
    return {
      totalDocs: readyDocs,
      totalChunks,
      pendingChunks,
      lastRebuildAt: lastRebuild?.updatedAt ?? null,
      recentTasks: indexTasks.map((t) => ({
        id: t.id,
        taskNo: t.taskNo,
        action: readTaskAction(t.payload),
        status: t.status,
        progress: t.progress,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
    };
  }

  /** 发起索引任务（重建/增量/清理）：D5 演示环境仅落任务记录，不真改 Qdrant */
  async createIndexTask(action: 'REBUILD' | 'INCREMENT' | 'CLEAN', strategy?: string) {
    const now = new Date();
    const seq = (await this.prisma.sysTask.count({
      where: { type: 'INDEX', createdAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } },
    })) + 1;
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const task = await this.prisma.sysTask.create({
      data: {
        taskNo: `IDX-${y}${m}${d}-${String(seq).padStart(3, '0')}`,
        type: 'INDEX',
        status: 'WAITING',
        stage: action,
        payload: { action, ...(strategy ? { strategy } : {}), demo: true } as Prisma.InputJsonValue,
      },
    });
    await this.prisma.taskLog.create({
      data: {
        taskId: task.id,
        level: 'INFO',
        message:
          action === 'REBUILD'
            ? '全量重建任务已登记（演示环境未执行真实操作，不影响现有检索）'
            : action === 'INCREMENT'
              ? `增量更新任务已登记，策略：${strategy ?? '默认'}（演示环境未执行真实操作）`
              : '脏数据清理任务已登记（演示环境未执行真实操作）',
      },
    });
    this.logger.log(`管理端登记索引任务：taskNo=${task.taskNo} action=${action}`);
    return {
      id: task.id,
      taskNo: task.taskNo,
      action,
      status: task.status,
      createdAt: task.createdAt,
    };
  }
}

/** 读取索引任务 payload 中的 action */
function readTaskAction(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && 'action' in payload) {
    const v = (payload as { action: unknown }).action;
    if (typeof v === 'string') return v;
  }
  return null;
}
