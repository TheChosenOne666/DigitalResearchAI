import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getTenantContext } from '../../common/auth/tenant-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import { SearchStoreService } from '../search/persistence/search.store.service';
import { WorkspaceStoreService } from '../workspace/workspace.store.service';
import { buildWord, type ExportReport, type ExportSource } from './export/word.builder';
import { buildPpt } from './export/ppt.builder';
import { buildPdf } from './export/pdf.builder';

/** 支持的导出格式 */
export type ExportFormat = 'docx' | 'pptx' | 'pdf';

/** 导出入参 */
export interface ExportInput {
  type: 'search' | 'workspace';
  id: string;
  format: ExportFormat;
}

/** 各格式的扩展名与 MIME 类型 */
const FORMAT_META: Record<ExportFormat, { ext: string; contentType: string }> = {
  docx: {
    ext: 'docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  pptx: {
    ext: 'pptx',
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  pdf: { ext: 'pdf', contentType: 'application/pdf' },
};

/** 导出结果 */
export interface ExportResult {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

/** 智搜报告来源 → 统一来源形状（idx 对应 {c:N}） */
function mapSearchSources(sources: Array<{
  idx: number; title: string; url: string | null; snippet: string;
}>): ExportSource[] {
  return sources.map((s) => ({ idx: s.idx, name: s.title, url: s.url, desc: s.snippet }));
}

/** 分析结果来源 → 统一来源形状（按数组序编号） */
function mapWorkspaceSources(sources: unknown): ExportSource[] {
  const arr = Array.isArray(sources) ? sources : [];
  return arr.map((s, i) => {
    const o = (s ?? {}) as { name?: string; url?: string; desc?: string };
    return { idx: i + 1, name: o.name ?? '未命名来源', url: o.url, desc: o.desc };
  });
}

/** 标题截断（过长标题压缩） */
function truncate(s: string, max = 50): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** 文件名安全化（去掉路径分隔符等） */
function safeFilename(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '').trim() || '报告';
}

/**
 * 报告导出服务（M4.4 / 18 智搜增强）：智搜报告 + 分析结果报告 → Word(.docx) / PPT(.pptx) / PDF(.pdf)。
 * 智搜报告正文 {c:N} → 上标 [N] + 文末来源表（引文映射）；导出落审计。
 */
@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);

  constructor(
    private readonly searchStore: SearchStoreService,
    private readonly workspaceStore: WorkspaceStoreService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** 组装统一导出输入并生成目标格式文件 */
  async export(input: ExportInput): Promise<ExportResult> {
    const { type, id, format } = input;
    if (!id || typeof id !== 'string') {
      throw new BizException(ErrorCode.PARAM_MISSING, '缺少报告 ID', HttpStatus.BAD_REQUEST);
    }

    const report = await this.loadReport(type, id);
    const buffer = await this.buildByFormat(format, report);

    await this.audit(type, id, format);

    const meta = FORMAT_META[format];
    return {
      buffer,
      filename: `${safeFilename(report.title)}.${meta.ext}`,
      contentType: meta.contentType,
    };
  }

  /**
   * 按格式生成文件二进制。
   * @param format 导出格式
   * @param report 归一化报告
   * @throws BizException 未知格式
   */
  private async buildByFormat(format: ExportFormat, report: ExportReport): Promise<Buffer> {
    switch (format) {
      case 'docx':
        return buildWord(report);
      case 'pptx':
        return buildPpt(report);
      case 'pdf':
        // 字体路径走配置（生产显式指定中文字体，避免依赖宿主环境字体）
        return buildPdf(report, this.config.get<string>('PDF_FONT_PATH'));
      default:
        throw new BizException(
          ErrorCode.VALIDATION_FAILED,
          `不支持的导出格式：${format}`,
          HttpStatus.BAD_REQUEST,
        );
    }
  }

  /** 按类型取报告，归一化为 ExportReport */
  private async loadReport(type: 'search' | 'workspace', id: string): Promise<ExportReport> {
    if (type === 'workspace') {
      const detail = await this.workspaceStore.reportDetail(id);
      const snap = (detail.paramsSnapshot ?? {}) as {
        indicator?: { name?: string };
        countries?: unknown[];
      };
      const createdAt = detail.createdAt ? new Date(detail.createdAt).toLocaleString() : '';
      return {
        title: detail.title,
        subtitle: `${createdAt} · 覆盖 ${snap.countries?.length ?? 0} 个国家/地区`,
        contentMd: detail.contentMd,
        sources: mapWorkspaceSources(detail.sources),
      };
    }

    // search：id 为 sessionId
    const detail = await this.searchStore.reportDetail(id);
    const snap = (detail.paramsSnapshot ?? {}) as { question?: string };
    const title = truncate(snap.question?.trim() || '智搜报告');
    const createdAt = detail.createdAt ? new Date(detail.createdAt).toLocaleString() : '';
    return {
      title,
      subtitle: createdAt,
      contentMd: detail.contentMd,
      sources: mapSearchSources(detail.sources),
    };
  }

  /** 导出审计埋点（失败不阻塞主流程） */
  private async audit(type: string, id: string, format: string): Promise<void> {
    const ctx = getTenantContext();
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: ctx?.tenantId ?? null,
          userId: ctx?.userId ?? null,
          action: 'EXPORT',
          targetType: 'report',
          targetId: id,
          detail: { type, format },
        },
      });
    } catch (e) {
      this.logger.warn(`导出审计写入失败: ${e instanceof Error ? e.message : e}`);
    }
  }
}
