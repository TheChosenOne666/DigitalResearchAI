import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService, SEARCH_CONNECTORS } from './search.service';
import { VerticalWorldBankConnector } from './connectors/vertical.connector';
import { LocalConnector } from './connectors/local.connector';
import { WebAnySearchConnector } from './connectors/web.connector';
import { IntentService } from './intent/intent.service';

/**
 * 智搜模块（M2 核心管道）。
 * 三路连接器：垂直路(WDI) + 本地桩 + 联网路(AnySearch 直连)；意图分类服务为 SSE 编排提供条件回填。
 */
@Module({
  controllers: [SearchController],
  providers: [
    SearchService,
    VerticalWorldBankConnector,
    LocalConnector,
    WebAnySearchConnector,
    IntentService,
    {
      provide: SEARCH_CONNECTORS,
      useFactory: (
        vertical: VerticalWorldBankConnector,
        local: LocalConnector,
        web: WebAnySearchConnector,
      ) => [vertical, local, web],
      inject: [VerticalWorldBankConnector, LocalConnector, WebAnySearchConnector],
    },
  ],
  exports: [SearchService],
})
export class SearchModule {}
