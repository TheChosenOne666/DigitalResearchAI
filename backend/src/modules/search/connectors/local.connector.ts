import { Injectable } from '@nestjs/common';
import type {
  ConnectorInput,
  SearchConnector,
  SearchHit,
  SourceType,
} from './connector.interface';

/**
 * 本地知识库路连接器（M3 接入，M2 返回空桩）。
 * 预留实现位，复用 fusion 代码；M2 管道中此路恒为空，不阻断整体。
 */
@Injectable()
export class LocalConnector implements SearchConnector {
  readonly sourceType: SourceType = 'local';

  async search(_input: ConnectorInput, _signal: AbortSignal): Promise<SearchHit[]> {
    return [];
  }
}
