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
import { KbService } from './kb.service';
import { KbStoreService } from './store/kb.store.service';
import type {
  GroupInput,
  LibraryInput,
  LibraryUpdate,
  DocumentFilter,
} from './store/kb.store.service';

/** 分页默认值 */
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

/** 上传文件最小形状（避免依赖 @types/multer） */
interface UploadedDoc {
  originalname: string;
  buffer: Buffer;
}

/**
 * 知识库控制器（M3.1：库/分组/文档 CRUD）。
 * 文档上传与学习队列在 M3.2 接入；召回测试与入库链路在 M3.4 实现。
 * 全部路由受租户行级隔离保护（prisma forTenant 自动注入 tenant_id）。
 */
@Controller('kb')
export class KbController {
  constructor(
    private readonly store: KbStoreService,
    private readonly kb: KbService,
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
    return this.kb.uploadDocument(id, groupId ?? null, file.originalname, file.buffer);
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
}