import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Embedding 服务配置（可由 ConfigService 注入，导出纯函数便于单测） */
export interface EmbedConfig {
  /** baseUrl，默认方舟 OpenAI 兼容地址 */
  baseUrl?: string;
  /** 模型名（OpenAI 兼容 embeddings 模型） */
  model?: string;
  /** API Key */
  apiKey?: string;
}

/**
 * 向量化服务（M3.2）：调用方舟 embedding（OpenAI 兼容 /embeddings）把文本转向量。
 * - 无 ARK_API_KEY → 返回 null（降级：文档不向量化，检索退纯全文，等 Key 后 relearn 补齐）；
 * - 调用失败 → 抛错（由上层将文档置 FAILED 或重试）。
 */
@Injectable()
export class EmbedService {
  private readonly logger = new Logger(EmbedService.name);
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: string;
  /** 是否启用向量化（有 Key 才启用） */
  readonly enabled: boolean;

  constructor(config: ConfigService) {
    const cfg: EmbedConfig = {
      baseUrl: config.get<string>('ARK_BASE_URL') ?? 'https://ark.cn-beijing.volces.com/api/v3',
      model: config.get<string>('EMBED_MODEL') ?? 'doubao-embedding-large-text-250515',
      apiKey: config.get<string>('ARK_API_KEY') ?? '',
    };
    this.baseUrl = cfg.baseUrl!.replace(/\/+$/, '');
    this.model = cfg.model!;
    this.apiKey = cfg.apiKey!;
    this.enabled = Boolean(this.apiKey);
  }

  /**
   * 把文本向量化。
   * @param texts 需要向量化的文本列表
   * @param signal 外部 AbortSignal（可选）
   * @returns 向量列表（维度 = 模型纬度）；未启用或失败时抛错/降级由调用方处理
   */
  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
      signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`embedding HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    const vectors = (json.data ?? []).map((d) => d.embedding ?? []);
    if (vectors.length !== texts.length) {
      throw new Error(`embedding 返回维度不匹配: 期望 ${texts.length}, 实际 ${vectors.length}`);
    }
    return vectors;
  }
}