import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import { Prisma, KbVisibility } from '../../generated/prisma/client';
import { KbLearningService, type LearnDocumentPayload } from '../kb/learning/learning.service';
import { parsePageParams, buildPageResult } from './pagination';

/** 允许入库的格式白名单（A-16 格式校验） */
const ALLOWED_MIME_TYPES = ['md', 'txt', 'pdf', 'docx', 'csv', 'xlsx', 'pptx'];

/** 校验项形状（重复性/完整性/合规性/格式） */
export interface ReviewCheck {
  status: 'PASS' | 'WARN' | 'FAIL';
  note: string;
}

/** 审核队列行（对外形状） */
export interface AdminKbReviewRow {
  id: string;
  tenantId: string;
  tenantName: string | null;
  libraryId: string;
  libraryName: string | null;
  groupId: string | null;
  groupName: string | null;
  name: string;
  mimeType: string;
  size: number;
  visibility: string;
  tags: string[];
  sourceSessionId: string | null;
  sourceType: string;
  submitter: string | null;
  createdAt: Date;
  checks: { duplicate: ReviewCheck; complete: ReviewCheck; compliance: ReviewCheck; format: ReviewCheck };
}

/** 知识库管理 · 管理端服务（A-16~A-19）。
 * D1/D3：跨租户走 PrismaService 本体（系统 client）；审核链路与用户端 kb/reviews 同语义
 * （PENDING=待审核，通过触发学习，驳回删除），但不依赖用户端租户上下文，学习队列复用 KbLearningService。
 * A-19 索引任务按 D5 仅落 sys_tasks 记录，不真改 Qdrant。
 */
@Injectable()
export class AdminKbService {
  private readonly logger = new Logger(AdminKbService.name);
  private queue: Queue | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly learning: KbLearningService,
    config: ConfigService,
  ) {
    // 懒初始化队列（与 KbService 同款；bullmq/Redis 不可用则降级同步学习）
    try {
      const url = config.get<string>('REDIS_URL', 'redis://localhost:6380')!;
      const u = new URL(url);
      this.queue = new Queue('chunk-embed', {
        connection: { host: u.hostname, port: Number(u.port || 6379), password: u.password || undefined },
      });
    } catch (e) {
      this.logger.warn(`BullMQ 不可用（${(e as Error).message}），审核通过将同步学习`);
      this.queue = null;
    }
  }

  // ===== A-16 知识审核 =====

  /** 跨租户待审核列表（含四项校验结果 + 分页） */
  async listReviews(query: { keyword?: string; page: number; pageSize: number }) {
    const where: Prisma.KbDocumentWhereInput = { status: 'PENDING' };
    const keyword = query.keyword?.trim();
    if (keyword) {
      where.name = { contains: keyword };
    }
    const params = parsePageParams(String(query.page), String(query.pageSize));
    const [total, docs] = await Promise.all([
      this.prisma.kbDocument.count({ where }),
      this.prisma.kbDocument.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: params.skip,
        take: params.take,
        select: {
          id: true, tenantId: true, libraryId: true, groupId: true, name: true,
          mimeType: true, size: true, visibility: true, tags: true,
          sourceSessionId: true, createdAt: true,
        },
      }),
    ]);

    const [tenantNames, libraries, groups, sessions, sensitiveWords, sameNameRows] = await Promise.all([
      this.loadTenantNames([...new Set(docs.map((d) => d.tenantId))]),
      docs.length
        ? this.prisma.kbLibrary.findMany({
            where: { id: { in: [...new Set(docs.map((d) => d.libraryId))] } },
            select: { id: true, name: true },
          })
        : [],
      docs.some((d) => d.groupId)
        ? this.prisma.kbGroup.findMany({
            where: { id: { in: docs.map((d) => d.groupId).filter((v): v is string => Boolean(v)) } },
            select: { id: true, name: true },
          })
        : [],
      docs.some((d) => d.sourceSessionId)
        ? this.prisma.searchSession.findMany({
            where: { id: { in: docs.map((d) => d.sourceSessionId).filter((v): v is string => Boolean(v)) } },
            select: { id: true, userId: true },
          })
        : [],
      this.prisma.sensitiveWord.findMany({ where: { enabled: true }, select: { word: true } }),
      docs.length
        ? this.prisma.kbDocument.findMany({
            where: {
              libraryId: { in: [...new Set(docs.map((d) => d.libraryId))] },
              name: { in: docs.map((d) => d.name) },
              id: { notIn: docs.map((d) => d.id) },
            },
            select: { libraryId: true, name: true },
          })
        : [],
    ]);

    const submitterIds = [...new Set(sessions.map((s) => s.userId))];
    const users = submitterIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: submitterIds } },
          select: { id: true, username: true, realName: true, nickname: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u.realName || u.nickname || u.username]));
    const sessionUser = new Map(sessions.map((s) => [s.id, s.userId]));
    const sameName = new Set(sameNameRows.map((r) => `${r.libraryId}:${r.name}`));
    const sensitiveList = sensitiveWords.map((w) => w.word.toLowerCase());

    const list = docs.map((d) => {
      const sourceType = d.sourceSessionId ? '检索成果入库' : '手动上传';
      const submitter = d.sourceSessionId ? (userMap.get(sessionUser.get(d.sourceSessionId) ?? '') ?? null) : null;
      return {
        id: d.id,
        tenantId: d.tenantId,
        tenantName: tenantNames.get(d.tenantId) ?? null,
        libraryId: d.libraryId,
        libraryName: libraries.find((l) => l.id === d.libraryId)?.name ?? null,
        groupId: d.groupId,
        groupName: groups.find((g) => g.id === d.groupId)?.name ?? null,
        name: d.name,
        mimeType: d.mimeType,
        size: d.size,
        visibility: d.visibility,
        tags: Array.isArray(d.tags) ? (d.tags as string[]) : [],
        sourceSessionId: d.sourceSessionId,
        sourceType,
        submitter,
        createdAt: d.createdAt,
        checks: {
          duplicate: sameName.has(`${d.libraryId}:${d.name}`)
            ? { status: 'WARN' as const, note: '库内存在同名条目，疑似重复' }
            : { status: 'PASS' as const, note: '通过' },
          complete:
            d.size <= 0
              ? { status: 'FAIL' as const, note: '内容为空' }
              : d.sourceSessionId
                ? { status: 'PASS' as const, note: '通过' }
                : { status: 'WARN' as const, note: '缺少引用来源字段' },
          compliance: sensitiveList.some((w) => d.name.toLowerCase().includes(w))
            ? { status: 'FAIL' as const, note: '标题命中敏感词' }
            : { status: 'PASS' as const, note: '通过' },
          format: ALLOWED_MIME_TYPES.includes(d.mimeType)
            ? { status: 'PASS' as const, note: '通过' }
            : { status: 'WARN' as const, note: `格式 ${d.mimeType} 不在常规白名单` },
        },
      };
    });
    return buildPageResult(list satisfies AdminKbReviewRow[], total, params);
  }

  /** 审核通过：原始内容校验后触发学习（入队优先，失败降级同步学习） */
  async approveReview(id: string) {
    const doc = await this.prisma.kbDocument.findUnique({
      where: { id },
      select: { id: true, tenantId: true, mimeType: true, status: true, fileData: true },
    });
    if (!doc) {
      throw new BizException(ErrorCode.NOT_FOUND, '文档不存在', HttpStatus.NOT_FOUND);
    }
    if (doc.status !== 'PENDING') {
      throw new BizException(ErrorCode.VALIDATION_FAILED, '该文档不在待审核状态', HttpStatus.BAD_REQUEST);
    }
    if (!doc.fileData || doc.fileData.byteLength === 0) {
      await this.learning.markFailed(doc.tenantId, doc.id, '原始内容缺失');
      throw new BizException(ErrorCode.VALIDATION_FAILED, '原始内容缺失，无法学习', HttpStatus.BAD_REQUEST);
    }
    const payload: LearnDocumentPayload = {
      tenantId: doc.tenantId,
      documentId: doc.id,
      mimeType: doc.mimeType as LearnDocumentPayload['mimeType'],
    };
    let status = 'FAILED';
    if (this.queue) {
      try {
        await this.queue.add('learn', payload, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
        status = 'LEARNING';
      } catch (e) {
        this.logger.warn(`入队失败，降级同步学习：${(e as Error).message}`);
      }
    }
    if (status === 'FAILED') {
      try {
        await this.learning.learn(payload);
        status = 'LEARNING';
      } catch (e) {
        await this.learning.markFailed(payload.tenantId, payload.documentId, (e as Error).message);
      }
    }
    this.logger.log(`管理端审核通过触发学习：doc=${doc.id} status=${status}`);
    return { id: doc.id, status };
  }

  /** 审核驳回：删除待审核文档（PENDING 无切片/向量，直接级联删除），原因必填 */
  async rejectReview(id: string, reason: string) {
    const doc = await this.prisma.kbDocument.findUnique({
      where: { id },
      select: { id: true, status: true, name: true },
    });
    if (!doc) {
      throw new BizException(ErrorCode.NOT_FOUND, '文档不存在', HttpStatus.NOT_FOUND);
    }
    if (doc.status !== 'PENDING') {
      throw new BizException(ErrorCode.VALIDATION_FAILED, '该文档不在待审核状态', HttpStatus.BAD_REQUEST);
    }
    await this.prisma.kbDocument.delete({ where: { id } });
    this.logger.log(`管理端审核驳回并移除文档：doc=${id} reason=${reason}`);
    return { id, rejected: true, reason };
  }

  /** 来源溯源：入库来源/所属库与分组/提交人/检索问题 */
  async trace(id: string) {
    const doc = await this.prisma.kbDocument.findUnique({
      where: { id },
      select: {
        id: true, tenantId: true, libraryId: true, groupId: true, name: true, mimeType: true,
        size: true, status: true, visibility: true, tags: true, sourceSessionId: true, createdAt: true,
      },
    });
    if (!doc) {
      throw new BizException(ErrorCode.NOT_FOUND, '文档不存在', HttpStatus.NOT_FOUND);
    }
    const [tenant, library, group, session] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: doc.tenantId }, select: { name: true } }),
      this.prisma.kbLibrary.findUnique({ where: { id: doc.libraryId }, select: { name: true } }),
      doc.groupId
        ? this.prisma.kbGroup.findUnique({ where: { id: doc.groupId }, select: { name: true } })
        : null,
      doc.sourceSessionId
        ? this.prisma.searchSession.findUnique({
            where: { id: doc.sourceSessionId },
            select: { id: true, question: true, userId: true },
          })
        : null,
    ]);
    const submitter = session
      ? await this.prisma.user.findUnique({
          where: { id: session.userId },
          select: { id: true, username: true, realName: true, nickname: true },
        })
      : null;
    return {
      id: doc.id,
      name: doc.name,
      status: doc.status,
      sourceType: doc.sourceSessionId ? '检索成果入库（U-11）' : '手动上传',
      tenantName: tenant?.name ?? null,
      libraryName: library?.name ?? null,
      groupName: group?.name ?? null,
      sourceQuestion: session?.question ?? null,
      sourceLink: null as string | null,
      submitter: submitter
        ? { id: submitter.id, name: submitter.realName || submitter.nickname || submitter.username }
        : null,
      tags: Array.isArray(doc.tags) ? (doc.tags as string[]) : [],
      createdAt: doc.createdAt,
    };
  }

  // ===== A-17 分类 / 标签 =====

  /** 分类列表（全量平铺，含层级/父级，前端组树） */
  async listCategories() {
    return this.prisma.kbCategory.findMany({ orderBy: [{ level: 'asc' }, { sort: 'asc' }, { name: 'asc' }] });
  }

  /** 新增分类（层级上限 3 级） */
  async createCategory(input: { name: string; parentId?: string; sort?: number }) {
    let level = 1;
    if (input.parentId) {
      const parent = await this.prisma.kbCategory.findUnique({ where: { id: input.parentId } });
      if (!parent) {
        throw new BizException(ErrorCode.NOT_FOUND, '上级分类不存在', HttpStatus.NOT_FOUND);
      }
      level = parent.level + 1;
      if (level > 3) {
        throw new BizException(ErrorCode.VALIDATION_FAILED, '分类层级上限 3 级', HttpStatus.BAD_REQUEST);
      }
    }
    const created = await this.prisma.kbCategory.create({
      data: { name: input.name, parentId: input.parentId ?? null, level, sort: input.sort ?? 0 },
    });
    this.logger.log(`管理端新增知识分类：id=${created.id} level=${level}`);
    return created;
  }

  /** 编辑分类（名称/排序；不可移动层级） */
  async updateCategory(id: string, input: { name?: string; sort?: number }) {
    const cat = await this.prisma.kbCategory.findUnique({ where: { id } });
    if (!cat) {
      throw new BizException(ErrorCode.NOT_FOUND, '分类不存在', HttpStatus.NOT_FOUND);
    }
    return this.prisma.kbCategory.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.sort !== undefined ? { sort: input.sort } : {}),
      },
    });
  }

  /** 分类停用/启用 */
  async setCategoryEnabled(id: string, enabled: boolean) {
    const cat = await this.prisma.kbCategory.findUnique({ where: { id } });
    if (!cat) {
      throw new BizException(ErrorCode.NOT_FOUND, '分类不存在', HttpStatus.NOT_FOUND);
    }
    const updated = await this.prisma.kbCategory.update({ where: { id }, data: { enabled } });
    this.logger.log(`管理端${enabled ? '启用' : '停用'}知识分类：id=${id}`);
    return { id: updated.id, enabled: updated.enabled };
  }

  /** 标签列表 */
  async listTags() {
    return this.prisma.kbTag.findMany({ orderBy: [{ useCount: 'desc' }, { name: 'asc' }] });
  }

  /** 新增标签（名称唯一） */
  async createTag(input: { name: string }) {
    const dup = await this.prisma.kbTag.findUnique({ where: { name: input.name } });
    if (dup) {
      throw new BizException(ErrorCode.CONFLICT, '标签名已存在', HttpStatus.CONFLICT);
    }
    const created = await this.prisma.kbTag.create({ data: { name: input.name } });
    this.logger.log(`管理端新增知识标签：id=${created.id}`);
    return created;
  }

  /** 编辑标签（改名需唯一） */
  async updateTag(id: string, input: { name?: string }) {
    const tag = await this.prisma.kbTag.findUnique({ where: { id } });
    if (!tag) {
      throw new BizException(ErrorCode.NOT_FOUND, '标签不存在', HttpStatus.NOT_FOUND);
    }
    if (input.name !== undefined && input.name !== tag.name) {
      const dup = await this.prisma.kbTag.findUnique({ where: { name: input.name } });
      if (dup) {
        throw new BizException(ErrorCode.CONFLICT, '标签名已存在', HttpStatus.CONFLICT);
      }
    }
    return this.prisma.kbTag.update({ where: { id }, data: input.name !== undefined ? { name: input.name } : {} });
  }

  /** 标签停用/启用 */
  async setTagEnabled(id: string, enabled: boolean) {
    const tag = await this.prisma.kbTag.findUnique({ where: { id } });
    if (!tag) {
      throw new BizException(ErrorCode.NOT_FOUND, '标签不存在', HttpStatus.NOT_FOUND);
    }
    const updated = await this.prisma.kbTag.update({ where: { id }, data: { enabled } });
    this.logger.log(`管理端${enabled ? '启用' : '停用'}知识标签：id=${id}`);
    return { id: updated.id, enabled: updated.enabled };
  }

  // ===== A-18 权限管理 =====

  /** 默认权限规则（sys_configs：kb.defaultVisibility / kb.privateScope） */
  async getPermissionRule() {
    const configs = await this.prisma.sysConfig.findMany({
      where: { key: { in: ['kb.defaultVisibility', 'kb.privateScope'] } },
    });
    return {
      defaultVisibility: configs.find((c) => c.key === 'kb.defaultVisibility')?.value ?? 'PRIVATE',
      privateScope: configs.find((c) => c.key === 'kb.privateScope')?.value ?? 'SUBMITTER',
    };
  }

  /** 保存默认权限规则（值域校验对齐 CONFIG_VALUE_RULES） */
  async updatePermissionRule(input: { defaultVisibility?: string; privateScope?: string }) {
    const updates: Array<{ key: string; value: string; label: string; remark: string }> = [];
    if (input.defaultVisibility !== undefined) {
      if (!['PRIVATE', 'PUBLIC', 'ORG'].includes(input.defaultVisibility)) {
        throw new BizException(ErrorCode.VALIDATION_FAILED, '默认权限取值不合法', HttpStatus.BAD_REQUEST);
      }
      updates.push({
        key: 'kb.defaultVisibility',
        value: input.defaultVisibility,
        label: '知识库默认可见性',
        remark: '新入库条目默认可见性（A-18）',
      });
    }
    if (input.privateScope !== undefined) {
      if (!['SUBMITTER', 'ORG', 'ADMIN'].includes(input.privateScope)) {
        throw new BizException(ErrorCode.VALIDATION_FAILED, '私有范围取值不合法', HttpStatus.BAD_REQUEST);
      }
      updates.push({
        key: 'kb.privateScope',
        value: input.privateScope,
        label: '私有条目可见范围',
        remark: '私有条目可见范围（A-18）',
      });
    }
    for (const u of updates) {
      await this.prisma.sysConfig.upsert({
        where: { key: u.key },
        create: { ...u, updatedBy: 'admin' },
        update: { value: u.value, updatedBy: 'admin' },
      });
    }
    this.logger.log(`管理端更新知识权限规则：${updates.map((u) => `${u.key}=${u.value}`).join(', ')}`);
    return this.getPermissionRule();
  }

  /** 条目权限列表（跨租户，已完成学习的条目） */
  async listPermissionItems(query: { keyword?: string; visibility?: string; page: number; pageSize: number }) {
    const where: Prisma.KbDocumentWhereInput = { status: 'READY' };
    if (query.visibility === 'PUBLIC' || query.visibility === 'PRIVATE') {
      where.visibility = query.visibility as KbVisibility;
    }
    const keyword = query.keyword?.trim();
    if (keyword) {
      where.name = { contains: keyword };
    }
    const params = parsePageParams(String(query.page), String(query.pageSize));
    const [total, docs] = await Promise.all([
      this.prisma.kbDocument.count({ where }),
      this.prisma.kbDocument.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: params.skip,
        take: params.take,
        select: { id: true, tenantId: true, libraryId: true, name: true, visibility: true, updatedAt: true },
      }),
    ]);
    const tenantNames = await this.loadTenantNames([...new Set(docs.map((d) => d.tenantId))]);
    const libraries = docs.length
      ? await this.prisma.kbLibrary.findMany({
          where: { id: { in: [...new Set(docs.map((d) => d.libraryId))] } },
          select: { id: true, name: true },
        })
      : [];
    const list = docs.map((d) => ({
      id: d.id,
      name: d.name,
      tenantName: tenantNames.get(d.tenantId) ?? null,
      libraryName: libraries.find((l) => l.id === d.libraryId)?.name ?? null,
      visibility: d.visibility,
      updatedAt: d.updatedAt,
    }));
    return buildPageResult(list, total, params);
  }

  /** 条目公开⇄私有切换（前端二次确认，后端审计） */
  async setItemVisibility(id: string, visibility: 'PUBLIC' | 'PRIVATE') {
    const doc = await this.prisma.kbDocument.findUnique({
      where: { id },
      select: { id: true, visibility: true, name: true },
    });
    if (!doc) {
      throw new BizException(ErrorCode.NOT_FOUND, '条目不存在', HttpStatus.NOT_FOUND);
    }
    if (doc.visibility === visibility) {
      throw new BizException(ErrorCode.VALIDATION_FAILED, '条目已是该可见性', HttpStatus.BAD_REQUEST);
    }
    const updated = await this.prisma.kbDocument.update({ where: { id }, data: { visibility } });
    this.logger.log(`管理端切换条目可见性：doc=${id} ${doc.visibility} -> ${visibility}`);
    return { id: updated.id, visibility: updated.visibility };
  }

  // ===== A-19 索引管理 =====

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

  /** 批量加载租户名（跨租户归属展示） */
  private async loadTenantNames(tenantIds: string[]): Promise<Map<string, string>> {
    if (!tenantIds.length) return new Map();
    const rows = await this.prisma.tenant.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
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
