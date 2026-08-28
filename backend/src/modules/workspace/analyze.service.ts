import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { getTenantContext } from '../../common/auth/tenant-context';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import { GenerateService } from '../search/generate/generate.service';
import type { GenerateChunk } from '../search/generate/generate.service';
import { KbStoreService } from '../kb/store/kb.store.service';
import { WorkspaceStoreService } from './workspace.store.service';
import {
  buildAnalyzePrompt,
  buildFallbackReport,
  computeStats,
  computeTable,
  type AnalyzeInput,
} from './analyze';

/** 分析结果 Top 表行数（数据分析表与降级报告数据解读共用） */
const TOP_N = 8;

/**
 * 分析结果生成服务（M4.3）：时序数据 → 确定性统计 → LLM 流式生成 14 章节 → 落库。
 * 统计卡片与数据分析表由确定性算法计算（数字准确、降级可渲染），LLM 仅负责文字章节。
 */
@Injectable()
export class AnalyzeService {
  private readonly logger = new Logger(AnalyzeService.name);

  constructor(
    private readonly generate: GenerateService,
    private readonly store: WorkspaceStoreService,
    private readonly kbStore: KbStoreService,
  ) {}

  /** 当前请求租户上下文 */
  private requireTenant(): { tenantId: string; userId: string } {
    const ctx = getTenantContext();
    if (!ctx) {
      throw new BizException(ErrorCode.UNAUTHORIZED, '缺少租户上下文', HttpStatus.UNAUTHORIZED);
    }
    return { tenantId: ctx.tenantId, userId: ctx.userId };
  }

  /** 规范化输入：年份升序、过滤无数据序列 */
  private normalize(input: AnalyzeInput): AnalyzeInput {
    const years = [...input.years].sort((a, b) => Number(a) - Number(b));
    const series = input.series.filter(
      (s) => s && typeof s.country === 'string' && s.values && years.some((y) => s.values[y] != null),
    );
    return { ...input, years, series };
  }

  /**
   * 生成分析结果：确定性统计 + 数据表 → LLM 流式生成 14 章节 → 落库。
   * @returns 报告 id（controller 据此推送 done 事件）
   */
  async analyze(
    input: AnalyzeInput,
    signal: AbortSignal,
    onChunk: (chunk: GenerateChunk) => void,
  ): Promise<{ reportId: string }> {
    const { userId } = this.requireTenant();
    const norm = this.normalize(input);
    const unit = norm.indicator.unit || '';
    const stats = computeStats(norm.series, norm.years);
    const table = computeTable(norm.series, norm.years, unit, TOP_N);
    const { system, prompt } = buildAnalyzePrompt(norm, stats, table);
    const fallbackText = buildFallbackReport(norm, stats, table);

    const generated = await this.generate.streamCustom(
      { system, prompt, fallbackText },
      signal,
      onChunk,
    );

    const title = `${norm.indicator.name} 数据分析报告`;
    const saved = await this.store.saveReport(userId, {
      title,
      contentMd: generated.fullText,
      paramsSnapshot: {
        indicator: norm.indicator,
        countries: norm.countries,
        years: norm.years,
        series: norm.series,
        chartConfig: norm.chartConfig ?? null,
        question: norm.question ?? null,
        stats,
        table,
      },
      sources: norm.sources,
      tokenUsage: generated.tokenUsage,
    });
    this.logger.log(
      `分析结果已生成：report=${saved.id} 国家=${norm.series.length} 年份=${norm.years.length} 字数=${generated.fullText.length}`,
    );
    return { reportId: saved.id };
  }

  /**
   * 整份分析结果存入知识库：报告正文作为一份 Markdown 文档落库，状态 PENDING 待审核。
   * 复用 M3 的存库链路（createDocument），审核通过后自动学习入库。
   */
  async saveToKb(
    reportId: string,
    body: { libraryId?: string; groupId?: string | null; visibility?: string; tags?: unknown },
  ): Promise<{ created: number; documents: Array<{ id: string; name: string }> }> {
    const { tenantId } = this.requireTenant();
    const detail = await this.store.reportDetail(reportId); // 校验归属（跨租户/不存在 → 404）
    if (!body.libraryId || typeof body.libraryId !== 'string') {
      throw new BizException(ErrorCode.PARAM_MISSING, '缺少目标知识库', HttpStatus.BAD_REQUEST);
    }
    const lib = await this.kbStore.getLibrary(body.libraryId);
    if (!lib) {
      throw new BizException(ErrorCode.NOT_FOUND, '目标知识库不存在', HttpStatus.NOT_FOUND);
    }
    let groupId: string | null = null;
    if (typeof body.groupId === 'string' && body.groupId) {
      const groups = await this.kbStore.listGroups(body.libraryId);
      if (!groups.some((g) => g.id === body.groupId)) {
        throw new BizException(ErrorCode.VALIDATION_FAILED, '分组不存在或不属于该知识库', HttpStatus.BAD_REQUEST);
      }
      groupId = body.groupId;
    }
    const visibility = body.visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE';
    const tags = Array.isArray(body.tags)
      ? body.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).slice(0, 10)
      : [];
    const name = detail.title;
    const content = `# ${name}\n\n${detail.contentMd}`;
    const buffer = Buffer.from(content, 'utf8');
    const doc = await this.kbStore.createDocument({
      tenantId,
      libraryId: body.libraryId,
      groupId,
      name,
      mimeType: 'md',
      size: buffer.byteLength,
      buffer,
      visibility,
      tags,
      sourceSessionId: reportId,
    });
    this.logger.log(`分析结果已提交入库：doc=${doc.id} report=${reportId} lib=${body.libraryId}`);
    return { created: 1, documents: [{ id: doc.id, name }] };
  }
}
