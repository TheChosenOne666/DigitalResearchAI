import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ErrorCode } from '@app/shared';
import { BizException } from '../../../common/exceptions/biz.exception';
import { getTenantContext } from '../../../common/auth/tenant-context';
import { SearchUploadService } from '../upload/search-upload.service';
import {
  ACTIVE_TASK_STATUSES,
  SearchTaskStoreService,
  type SearchTaskRow,
  type SearchTaskStatus,
} from '../persistence/search-task.store.service';

/** 生成任务的章节总数（与 generate.REPORT_SECTIONS 对齐，由调用方传入以免循环依赖） */
export interface TaskListParams {
  status?: 'active' | 'done' | 'failed';
  page: number;
  pageSize: number;
}

/**
 * 智搜任务管控（18 批 4）。
 *
 * 职责：把检索/生成流程的关键节点映射为任务状态，并提供列表、中止、删除。
 * 设计取舍：
 * - 「中止」用**任务状态本身**做信号（不引入 Redis 标记）：`requestAbort` 把进行中任务置为 ABORTED，
 *   生成流程在**章节边界**重读状态，发现被中止则停止后续章节——分段生成天然提供了检查点；
 * - 「重试」不单独提供接口：检索失败时试额已回滚，前端用原问题重新发起检索即可（净效果不重复扣费）。
 */
@Injectable()
export class SearchTaskService implements OnModuleInit {
  private readonly logger = new Logger(SearchTaskService.name);

  constructor(
    private readonly store: SearchTaskStoreService,
    /** 18 批 3 联动：任务删除时清理上传资料 */
    private readonly upload: SearchUploadService,
  ) {}

  /**
   * 服务启动时收敛僵尸任务：把「进行中」但长时间未更新的任务置为失败（可续跑），
   * 避免服务重启后遗留「永远卡在生成中」的任务记录。
   */
  async onModuleInit(): Promise<void> {
    await this.reapStale();
  }

  /** 创建检索任务（初始 RETRIEVING） */
  async startRetrieval(sessionId: string): Promise<string> {
    const { id } = await this.store.create(sessionId, 'retrieval', 'RETRIEVING');
    return id;
  }

  /** 检索完成、等待用户选数据 → PENDING_SELECT（不占资源） */
  async markPendingSelect(taskId: string): Promise<void> {
    await this.store.update(taskId, { status: 'PENDING_SELECT', progress: 100 });
  }

  /** 创建生成任务（初始 GENERATING） */
  async startGenerate(sessionId: string): Promise<string> {
    const { id } = await this.store.create(sessionId, 'generate', 'GENERATING');
    return id;
  }

  /**
   * 续跑抢占：**仅当任务仍处于可续跑态**（中断/失败）时置为进行中。
   * 用条件更新（CAS）而非「先读后写」，防止重复点击 / 并发请求把同一任务双跑
   * ——双跑会各自调一次 `upsertUsage`，造成 token 用量重复累加。
   * @param taskId 任务 id
   * @param progress 当前进度（已完成章节占比）
   * @throws BizException 任务已被其它请求接续或状态已变化（409）
   */
  async claimForResume(taskId: string, progress: number): Promise<void> {
    const ok = await this.store.updateIfStatus(taskId, ['ABORTED', 'GENERATE_FAILED'], {
      status: 'GENERATING',
      progress,
      errorMsg: null,
    });
    if (!ok) {
      throw new BizException(
        ErrorCode.CONFLICT,
        '该任务已被接续或状态已变化，请刷新任务列表后重试',
        HttpStatus.CONFLICT,
      );
    }
  }

  /**
   * 推进生成进度（按已完成章节数折算 0-100）。
   * @param taskId 任务 id
   * @param done 已完成章节数
   * @param total 章节总数
   */
  async updateProgress(taskId: string, done: number, total: number): Promise<void> {
    const progress = total > 0 ? Math.round((done / total) * 100) : 0;
    await this.store.update(taskId, { progress });
  }

  /** 标记任务完成 */
  async markDone(taskId: string): Promise<void> {
    await this.store.update(taskId, { status: 'DONE', progress: 100, errorMsg: null, finish: true });
  }

  /**
   * 标记任务失败。
   * @param taskId 任务 id
   * @param status 失败状态（检索/生成）
   * @param msg 面向用户的失败原因
   */
  async markFailed(
    taskId: string,
    status: Extract<SearchTaskStatus, 'RETRIEVAL_FAILED' | 'GENERATE_FAILED'>,
    msg: string,
  ): Promise<void> {
    await this.store.update(taskId, { status, errorMsg: msg.slice(0, 500), finish: true });
  }

  /**
   * 标记任务被中止（内容保留，可续跑）。
   * @param taskId 任务 id
   * @param errorMsg 可选的失败明细覆写（如逐章失败原因），缺省为通用中止文案
   */
  async markAborted(taskId: string, errorMsg?: string): Promise<void> {
    await this.store.update(taskId, {
      status: 'ABORTED',
      errorMsg: (errorMsg?.trim() || '已中止，可继续生成').slice(0, 500),
      finish: true,
    });
  }

  /**
   * 请求中止进行中的任务：把状态置为 ABORTED 作为信号，
   * 生成流程在下一个章节边界读取到该状态后停止。
   * @throws BizException 任务不存在或已结束
   */
  async requestAbort(taskId: string): Promise<SearchTaskRow> {
    const task = await this.store.get(taskId);
    if (!task) {
      throw new BizException(ErrorCode.NOT_FOUND, '任务不存在', HttpStatus.NOT_FOUND);
    }
    if (!ACTIVE_TASK_STATUSES.includes(task.status)) {
      throw new BizException(
        ErrorCode.CONFLICT,
        `任务当前状态（${task.status}）不可中止`,
        HttpStatus.CONFLICT,
      );
    }
    await this.markAborted(taskId);
    this.logger.log(`任务中止请求已记录 task=${taskId} status=${task.status}`);
    return { ...task, status: 'ABORTED' };
  }

  /**
   * 是否已被请求中止（生成流程的章节边界检查点）。
   * 读取失败一律按「未中止」处理，避免把中止信号误判成流程异常。
   */
  async isAborted(taskId: string): Promise<boolean> {
    try {
      const task = await this.store.get(taskId);
      return task?.status === 'ABORTED';
    } catch (e) {
      this.logger.warn(`中止状态查询失败（按未中止处理）：${(e as Error).message}`);
      return false;
    }
  }

  /** 任务列表（分页 + 状态分组） */
  async list(params: TaskListParams): Promise<{ items: SearchTaskRow[]; total: number }> {
    return this.store.list(params);
  }

  /** 取任务（不存在抛 404） */
  async getOrThrow(taskId: string): Promise<SearchTaskRow> {
    const task = await this.store.get(taskId);
    if (!task) {
      throw new BizException(ErrorCode.NOT_FOUND, '任务不存在', HttpStatus.NOT_FOUND);
    }
    return task;
  }

  /** 删除任务记录（不影响已生成的报告），并顺手清理该用户已过期的上传资料 */
  async remove(taskId: string): Promise<void> {
    const ok = await this.store.remove(taskId);
    if (!ok) {
      throw new BizException(ErrorCode.NOT_FOUND, '任务不存在', HttpStatus.NOT_FOUND);
    }
    // 18 批 3 联动：上传资料与会话/任务没有关联字段（上传发生在检索前），
    // 故无法按任务精确清理，改为按用户清理已过期资料——满足「不长期滞留」的意图。
    // 清理失败不影响删除结果（已过期资料本就会被下次上传时的懒删除回收）。
    try {
      const ctx = getTenantContext();
      if (ctx) await this.upload.cleanupExpired(ctx.userId);
    } catch (e) {
      this.logger.warn(`清理过期上传资料失败：${(e as Error).message}`);
    }
  }

  /**
   * 校验任务是否可续跑（生成任务 + 中断/失败态），返回任务供调用方使用。
   * @throws BizException 类型不符或状态不可续跑
   */
  async ensureResumable(taskId: string): Promise<SearchTaskRow> {
    const task = await this.getOrThrow(taskId);
    if (task.type !== 'generate') {
      throw new BizException(
        ErrorCode.VALIDATION_FAILED,
        '仅生成任务支持继续生成',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!['GENERATE_FAILED', 'ABORTED'].includes(task.status)) {
      throw new BizException(
        ErrorCode.CONFLICT,
        `任务当前状态（${task.status}）不可继续生成`,
        HttpStatus.CONFLICT,
      );
    }
    return task;
  }

  /**
   * 服务启动时收敛僵尸任务（进行中但长时间未更新）。
   * @param timeoutMs 超时阈值
   */
  async reapStale(timeoutMs = 30 * 60 * 1000): Promise<number> {
    return this.store.reapStale(timeoutMs);
  }
}
