import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { SearchTaskService } from './search-task.service';

/** 列表分页默认与上限 */
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

/** 任务列表查询参数（字符串入参，内部收敛为数字/枚举） */
interface TaskListQuery {
  status?: string;
  page?: string;
  pageSize?: string;
}

/**
 * 智搜任务管控接口（18 批 4）。
 *
 * - `GET    /search/tasks`            任务列表（分页 + 状态分组 active/done/failed）
 * - `POST   /search/tasks/:id/abort`  中止进行中的任务（写 ABORTED 作为信号，生成流程在章节边界停止）
 * - `DELETE /search/tasks/:id`        删除任务记录（不影响已生成的报告）
 *
 * 「继续生成」为 SSE 流式接口，因需复用生成编排，置于 `SearchController`（`POST /search/tasks/:id/resume`）。
 * 「重试检索」不单独提供接口：检索失败时试额已回滚，前端用原问题重新发起检索即可（净效果不重复扣费）。
 */
@Controller('search/tasks')
export class SearchTaskController {
  constructor(private readonly task: SearchTaskService) {}

  /** 任务列表（本人任务，按创建时间倒序） */
  @Get()
  @HttpCode(HttpStatus.OK)
  async list(@Query() query: TaskListQuery): Promise<unknown> {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number(query.pageSize) || DEFAULT_PAGE_SIZE),
    );
    const statusGroup = ['active', 'done', 'failed'].includes(query.status ?? '')
      ? (query.status as 'active' | 'done' | 'failed')
      : undefined;
    const { items, total } = await this.task.list({ status: statusGroup, page, pageSize });
    return { items, total, page, pageSize };
  }

  /** 中止进行中的任务（已结束的任务返回 409） */
  @Post(':id/abort')
  @HttpCode(HttpStatus.OK)
  async abort(@Param('id') id: string): Promise<unknown> {
    const task = await this.task.requestAbort(id);
    return { id: task.id, status: task.status };
  }

  /** 删除任务记录（报告本身保留在「我的报告」） */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string): Promise<unknown> {
    await this.task.remove(id);
    return { deleted: true };
  }
}
