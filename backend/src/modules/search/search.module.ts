import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { KbModule } from '../kb/kb.module';
import { MemberModule } from '../member/member.module';
import { SearchController } from './search.controller';
import { SearchService, SEARCH_CONNECTORS } from './search.service';
import { VerticalWorldBankConnector } from './connectors/vertical.connector';
import { LocalConnector } from './connectors/local.connector';
import { WebAnySearchConnector } from './connectors/web.connector';
import { IntentService } from './intent/intent.service';
import { GenerateService } from './generate/generate.service';
import { SearchStoreService } from './persistence/search.store.service';
import { SearchCacheService } from './search-cache.service';
import { RerankService } from './fusion/rerank.service';

/**
 * 智搜模块（M2 核心管道）。
 * 三路连接器：垂直路(WDI) + 本地路(KbRetriever 混合检索，M3.3 生效) + 联网路(AnySearch 直连)；
 * 意图分类(M2.2) + 流式生成(M2.3) + 会话/报告/来源/用量持久化(M2.3) 为 SSE 编排提供服务。
 * M5.3：引入 MemberModule 复用 QuotaService，智搜入口做免费体验配额拦截。
 */
@Module({
  imports: [PrismaModule, KbModule, MemberModule],
  controllers: [SearchController],
  providers: [
    SearchService,
    VerticalWorldBankConnector,
    LocalConnector,
    WebAnySearchConnector,
    IntentService,
    GenerateService,
    SearchStoreService,
    SearchCacheService,
    RerankService,
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
  exports: [SearchService, GenerateService, SearchStoreService],
})
export class SearchModule {}
