import { Injectable, Logger } from '@nestjs/common';
import type {
  ConnectorInput,
  SearchConnector,
  SearchHit,
  ConnectorSourceType,
} from './connector.interface';
import { KbRetrieverService } from '../../kb/retriever/kb.retriever.service';

/**
 * 本地知识库路连接器（M3.3 起真实生效）：
 * 委托 KbRetrieverService 做 Qdrant 向量 + PG 全文混合检索 → RRF；
 * 失败显式告警并返回空（单路异常不阻断整体管道，超时由管道层熔断兜底）。
 */
@Injectable()
export class LocalConnector implements SearchConnector {
  readonly sourceType: ConnectorSourceType = 'local';
  private readonly logger = new Logger(LocalConnector.name);

  constructor(private readonly retriever: KbRetrieverService) {}

  async search(input: ConnectorInput, signal: AbortSignal): Promise<SearchHit[]> {
    try {
      const hits = await this.retriever.search(input.question, signal);
      this.logger.debug(`本地路命中 ${hits.length} 条`);
      return hits;
    } catch (e) {
      // 管道层吞错静默，这里必须显式记录否则线上无从排查
      this.logger.warn(`本地路检索失败：${e instanceof Error ? e.message : e}`);
      return [];
    }
  }
}
