import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ErrorCode } from '@app/shared';
import { BizException } from '../../../common/exceptions/biz.exception';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { getTenantContext } from '../../../common/auth/tenant-context';
import { DocParserService, detectMimeType } from '../../kb/parse/doc-parser.service';
import type { SearchHit } from '../connectors/connector.interface';

/** 允许上传的扩展名（与 DocParserService 支持的解析类型一致） */
const ALLOWED_EXT = new Set(['xlsx', 'xls', 'csv', 'docx', 'doc', 'pdf', 'txt', 'md']);

/** 单次最多上传文件数（与 DTO 的 uploadIds max(5) 对齐） */
export const MAX_UPLOAD_FILES = 5;

/** 单文件大小上限（与工作台上传限额一致） */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** 单文件解析文本上限（超出截断，防超长文档撑爆生成上下文） */
export const MAX_CONTENT_CHARS = 50_000;

/** 资料有效期（分钟）：与检索快照恢复窗口保持一致 */
const UPLOAD_TTL_MINUTES = 30;

/** 单个文件的处理结果（成功含 id，失败含原因，逐条返回不互相影响） */
export interface UploadFileResult {
  name: string;
  size: number;
  status: 'parsed' | 'failed';
  /** 成功时的资料 id（作为 search/stream 的 uploadIds 传入） */
  id?: string;
  /** 失败原因（面向用户的提示） */
  error?: string;
}

/** 上传文件的最小形态（multer 内存存储） */
export interface UploadedFileShape {
  originalname: string;
  buffer: Buffer;
}

/**
 * 智搜补充上传本地资料（18 智搜增强批 3）。
 *
 * 定位：用户手头的文档（Excel/CSV/Word/PDF/文本）作为**本次检索的额外来源**，
 * 与检索结果一并展示在选择态并参与报告生成；**不自动进入知识库**，仅本次会话可用。
 * 解析复用知识库的 `DocParserService`（xlsx/mammoth/pdf-parse），不重复实现。
 */
@Injectable()
export class SearchUploadService {
  private readonly logger = new Logger(SearchUploadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: DocParserService,
  ) {}

  /** 当前请求租户上下文（受保护路由由拦截器注入；缺失视为未授权） */
  private requireTenant(): { tenantId: string; userId: string } {
    const ctx = getTenantContext();
    if (!ctx) {
      throw new BizException(ErrorCode.UNAUTHORIZED, '缺少租户上下文', HttpStatus.UNAUTHORIZED);
    }
    return { tenantId: ctx.tenantId, userId: ctx.userId };
  }

  /**
   * 接收并解析上传文件：校验格式/大小 → 解析文本 → 落库（仅成功者）。
   * 单个文件失败不影响其它文件，结果逐条返回。
   * @param files multer 解析出的文件数组
   * @returns 每个文件的处理结果（成功带 id 供后续检索引用）
   */
  async save(files: UploadedFileShape[]): Promise<UploadFileResult[]> {
    if (!files.length) {
      throw new BizException(ErrorCode.PARAM_MISSING, '缺少上传文件', HttpStatus.BAD_REQUEST);
    }
    if (files.length > MAX_UPLOAD_FILES) {
      throw new BizException(
        ErrorCode.VALIDATION_FAILED,
        `单次最多上传 ${MAX_UPLOAD_FILES} 个文件`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const { tenantId, userId } = this.requireTenant();
    // 顺手清理该用户已过期资料（懒删除，避免为清理引入定时任务）
    await this.cleanupExpired(userId);

    const results: UploadFileResult[] = [];
    for (const file of files) {
      results.push(await this.saveOne(file, tenantId, userId));
    }
    return results;
  }

  /** 处理单个文件：解析失败一律不落库，仅返回失败原因 */
  private async saveOne(
    file: UploadedFileShape,
    tenantId: string,
    userId: string,
  ): Promise<UploadFileResult> {
    const name = file.originalname || '未命名文件';
    const size = file.buffer?.length ?? 0;
    const base = { name, size };

    const ext = (name.split('.').pop() ?? '').toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      return {
        ...base,
        status: 'failed',
        error: `不支持的格式（.${ext || '无扩展名'}），支持 xlsx/xls/csv/docx/doc/pdf/txt/md`,
      };
    }
    if (size === 0) return { ...base, status: 'failed', error: '文件内容为空' };
    if (size > MAX_UPLOAD_BYTES) {
      return {
        ...base,
        status: 'failed',
        error: `文件超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 上限`,
      };
    }

    const mimeType = detectMimeType(name);
    let text: string;
    try {
      text = await this.parser.parse(mimeType, file.buffer, name);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '解析失败';
      this.logger.warn(`本地资料解析失败 name=${name} ext=${ext}: ${msg}`);
      return { ...base, status: 'failed', error: `解析失败：${msg}` };
    }

    const trimmed = text.trim();
    if (!trimmed) return { ...base, status: 'failed', error: '解析结果为空，无法作为参考资料' };
    const contentMd =
      trimmed.length > MAX_CONTENT_CHARS
        ? `${trimmed.slice(0, MAX_CONTENT_CHARS)}\n\n…（内容过长，已截断）`
        : trimmed;

    const saved = await this.prisma.forTenant.searchUpload.create({
      data: {
        tenantId,
        userId,
        name,
        mimeType,
        size,
        contentMd,
        expiresAt: new Date(Date.now() + UPLOAD_TTL_MINUTES * 60_000),
      },
    });
    this.logger.log(
      `本地资料已入库 id=${saved.id} name=${name} type=${mimeType} chars=${contentMd.length}`,
    );
    return { ...base, status: 'parsed', id: saved.id };
  }

  /**
   * 按 id 加载资料并转为统一命中（供检索管道前置并入来源）。
   * 仅返回**属于当前用户且未过期**的记录；越权 id 静默忽略（不暴露存在性）。
   * @param ids 上传接口返回的资料 id 列表
   * @returns 统一 SearchHit（sourceType='upload'，按传入顺序）
   */
  async loadHits(ids: string[]): Promise<SearchHit[]> {
    if (!ids.length) return [];
    const { userId } = this.requireTenant();
    const unique = [...new Set(ids)];
    // 经 forTenant 自动注入 tenantId；再按 userId + 未过期过滤
    const rows = await this.prisma.forTenant.searchUpload.findMany({
      where: { id: { in: unique }, userId, expiresAt: { gt: new Date() } },
    });
    if (rows.length !== unique.length) {
      this.logger.warn(`本地资料部分不可用：请求 ${unique.length} 条，命中 ${rows.length} 条`);
    }
    // 保持用户选择的顺序（findMany 无序）
    const byId = new Map(rows.map((r) => [r.id, r]));
    return unique.flatMap((id) => {
      const row = byId.get(id);
      if (!row) return [];
      return [
        {
          title: row.name,
          snippet: row.contentMd.slice(0, 200),
          contentMd: row.contentMd,
          sourceType: 'upload' as const,
          meta: { uploadId: row.id, size: row.size, mimeType: row.mimeType },
        },
      ];
    });
  }

  /** 清理该用户已过期资料（懒删除：上传时顺手执行，返回删除条数） */
  async cleanupExpired(userId: string): Promise<number> {
    const { count } = await this.prisma.forTenant.searchUpload.deleteMany({
      where: { userId, expiresAt: { lte: new Date() } },
    });
    if (count > 0) this.logger.log(`清理过期本地资料 ${count} 条 userId=${userId}`);
    return count;
  }
}
