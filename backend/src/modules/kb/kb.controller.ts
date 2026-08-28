import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ErrorCode } from '@app/shared';
import { BizException } from '../../common/exceptions/biz.exception';
import { RoleCode, Roles } from '../../common/auth/roles.decorator';
import { KbService } from './kb.service';
import { KbStoreService } from './store/kb.store.service';
import {
  LOCAL_MAX_HITS,
  gradeSimilarity,
  KbRetrieverService,
} from './retriever/kb.retriever.service';
import type {
  GroupInput,
  LibraryInput,
  LibraryUpdate,
  DocumentFilter,
} from './store/kb.store.service';

/** 分页默认值 */
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

/** 召回测试入参 */
export interface RecallTestInput {
  question?: string;
  topN?: number;
}

/** 智搜来源存入知识库入参 */
export interface SaveToKbInput {
  libraryId?: string;
  groupId?: string | null;
  visibility?: string;
  tags?: unknown;
}

/** 上传文件最小形状（避免依赖 @types/multer） */
interface UploadedDoc {
  originalname: string;
  buffer: Buffer;
}

/**
 * 还原 multer 强转的原始文件名编码。
 * multer 1.x（@nestjs/platform-express 内置）在解析 multipart filename 时按 latin1
 * 逐字节解码，中文（UTF-8）文件名会被强转成 mojibake（如「教程」→「æå」）。
 * 此处按 latin1 还原字节、再按 UTF-8 解码，得到正确中文；纯 ASCII 文件名（字节 < 0x80）
 * 转换前后等价，无副作用。
 * 注意：若将来升级 multer 2.x（busboy 1.x 已按 UTF-8 正确解码 filename），应直接透传。
 */
export function decodeUploadFilename(originalname: string): string {
  return Buffer.from(originalname, 'latin1').toString('utf8');
}

/**
 * 知识库控制器（M3.1 库/分组/文档 CRUD → M3.2 上传/重学 → M3.4 召回测试 + 审核队列）。
 * 全部路由受租户行级隔离保护（prisma forTenant 自动注入 tenant_id）；
 * 审核三端点限 DATA_ADMIN / PLATFORM_ADMIN。
 */
@Controller('kb')
export class KbController {
  constructor(
    private readonly store: KbStoreService,
    private readonly kb: KbService,
    private readonly retriever: KbRetrieverService,
  ) {}

  // ===== 库 =====

  @Get('libraries')
  @HttpCode(HttpStatus.OK)
  listLibraries() {
    return this.store.listLibraries();
  }

  @Post('libraries')
  @HttpCode(HttpStatus.CREATED)
  createLibrary(@Body() body: LibraryInput) {
    return this.store.createLibrary(body);
  }

  @Get('libraries/:id')
  @HttpCode(HttpStatus.OK)
  async getLibrary(@Param('id') id: string) {
    const lib = await this.store.getLibrary(id);
    if (!lib) {
      throw new BizException(ErrorCode.NOT_FOUND, '知识库不存在', HttpStatus.NOT_FOUND);
    }
    return lib;
  }

  @Put('libraries/:id')
  @HttpCode(HttpStatus.OK)
  updateLibrary(@Param('id') id: string, @Body() body: LibraryUpdate) {
    return this.store.updateLibrary(id, body);
  }

  @Delete('libraries/:id')
  @HttpCode(HttpStatus.OK)
  deleteLibrary(@Param('id') id: string) {
    return this.store.deleteLibrary(id);
  }

  // ===== 分组 =====

  @Get('libraries/:id/groups')
  @HttpCode(HttpStatus.OK)
  listGroups(@Param('id') id: string) {
    return this.store.listGroups(id);
  }

  @Post('libraries/:id/groups')
  @HttpCode(HttpStatus.CREATED)
  createGroup(@Param('id') id: string, @Body() body: GroupInput) {
    return this.store.createGroup(id, body);
  }

  @Put('libraries/:id/groups/:gid')
  @HttpCode(HttpStatus.OK)
  updateGroup(@Param('id') id: string, @Param('gid') gid: string, @Body() body: GroupInput) {
    return this.store.updateGroup(id, gid, body);
  }

  @Delete('libraries/:id/groups/:gid')
  @HttpCode(HttpStatus.OK)
  deleteGroup(@Param('id') id: string, @Param('gid') gid: string) {
    return this.store.deleteGroup(id, gid);
  }

  // ===== 文档 =====

  @Get('libraries/:id/documents')
  @HttpCode(HttpStatus.OK)
  async listDocuments(
    @Param('id') id: string,
    @Query('groupId') groupId?: string,
    @Query('status') status?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = String(DEFAULT_PAGE_SIZE),
  ) {
    const filter: DocumentFilter = {};
    if (groupId) filter.groupId = groupId;
    if (status) filter.status = status;
    const p = Math.max(1, Number(page) || 1);
    const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE));
    return this.store.listDocuments(id, filter, p, size);
  }

  @Get('documents/:id')
  @HttpCode(HttpStatus.OK)
  async getDocument(@Param('id') id: string) {
    const doc = await this.store.getDocument(id);
    if (!doc) {
      throw new BizException(ErrorCode.NOT_FOUND, '文档不存在', HttpStatus.NOT_FOUND);
    }
    return doc;
  }

  @Post('libraries/:id/documents')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  async uploadDocument(
    @Param('id') id: string,
    @UploadedFile() file: UploadedDoc,
    @Query('groupId') groupId?: string,
  ) {
    if (!file) {
      throw new BizException(ErrorCode.PARAM_MISSING, '缺少上传文件', HttpStatus.BAD_REQUEST);
    }
    return this.kb.uploadDocument(id, groupId ?? null, decodeUploadFilename(file.originalname), file.buffer);
  }

  @Post('libraries/:id/documents/:did/relearn')
  @HttpCode(HttpStatus.OK)
  relearn(@Param('id') id: string, @Param('did') did: string) {
    return this.kb.relearn(id, did);
  }

  @Delete('documents/:id')
  @HttpCode(HttpStatus.OK)
  deleteDocument(@Param('id') id: string) {
    return this.store.deleteDocument(id);
  }

  // ===== 召回测试（M3.4）=====

  /** 召回测试：单库混合检索 → 命中片段 + 相似度分级（高 ≥0.7 / 中 ≥0.4 / 低 <0.4） */
  @Post('libraries/:id/recall-test')
  @HttpCode(HttpStatus.OK)
  async recallTest(@Param('id') id: string, @Body() body: RecallTestInput) {
    const lib = await this.store.getLibrary(id);
    if (!lib) {
      throw new BizException(ErrorCode.NOT_FOUND, '知识库不存在', HttpStatus.NOT_FOUND);
    }
    const question = (body?.question ?? '').trim();
    if (!question) {
      throw new BizException(ErrorCode.VALIDATION_FAILED, '请输入测试问题', HttpStatus.BAD_REQUEST);
    }
    const topN = Math.min(LOCAL_MAX_HITS, Math.max(1, Number(body?.topN) || 8));
    const startedAt = Date.now();
    const hits = await this.retriever.search(question, undefined, { libraryId: id });
    return {
      question,
      tookMs: Date.now() - startedAt,
      total: hits.length,
      hits: hits.slice(0, topN).map((hit, order) => ({
        order: order + 1,
        title: hit.title,
        snippet: hit.snippet,
        contentMd: hit.contentMd ?? '',
        similarity: hit.rawScore ?? 0,
        grade: gradeSimilarity(hit.rawScore ?? 0),
        libraryId: (hit.meta as { libraryId?: string } | undefined)?.libraryId ?? null,
        groupId: (hit.meta as { groupId?: string | null } | undefined)?.groupId ?? null,
        documentId: (hit.meta as { documentId?: string } | undefined)?.documentId ?? null,
        chunkIndex: (hit.meta as { idx?: number } | undefined)?.idx ?? null,
      })),
    };
  }

  // ===== 审核队列（M3.4，管理端雏形；管理页 UI 归 M6）=====

  /** 待审核文档列表（来源存入后停留 PENDING） */
  @Get('reviews')
  @Roles(RoleCode.DATA_ADMIN, RoleCode.PLATFORM_ADMIN)
  @HttpCode(HttpStatus.OK)
  listReviews(
    @Query('libraryId') libraryId?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = String(DEFAULT_PAGE_SIZE),
  ) {
    const p = Math.max(1, Number(page) || 1);
    const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE));
    return this.store.listPendingReviews({ libraryId }, p, size);
  }

  /** 审核通过：触发自动学习（入 BullMQ 队列，队列不可用降级同步学习） */
  @Post('documents/:id/approve')
  @Roles(RoleCode.DATA_ADMIN, RoleCode.PLATFORM_ADMIN)
  @HttpCode(HttpStatus.OK)
  approveReview(@Param('id') id: string) {
    return this.kb.approveReview(id);
  }

  /** 审核拒绝：移除待审核文档 */
  @Post('documents/:id/reject')
  @Roles(RoleCode.DATA_ADMIN, RoleCode.PLATFORM_ADMIN)
  @HttpCode(HttpStatus.OK)
  rejectReview(@Param('id') id: string) {
    return this.kb.rejectReview(id);
  }
}