import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { KbController } from './kb.controller';
import { KbService } from './kb.service';
import { KbStoreService } from './store/kb.store.service';
import { KbLearningStoreService } from './store/kb-learning.store.service';
import { KbRetrievalStoreService } from './store/kb-retrieval.store.service';
import { DocParserService } from './parse/doc-parser.service';
import { EmbedService } from './embeddings/embed.service';
import { QdrantService } from './vector/qdrant.service';
import { KbLearningService } from './learning/learning.service';
import { ChunkEmbedProcessor } from './queue/chunk-embed.processor';
import { KbRetrieverService } from './retriever/kb.retriever.service';

/**
 * 知识库模块。
 * M3.1：库/分组/文档 CRUD；M3.2：上传解析 + 学习队列；M3.3：混合检索（KbRetriever）供智搜本地路复用。
 * 持久化按隔离语义拆分：KbStoreService（请求态 forTenant）+ KbLearningStoreService / KbRetrievalStoreService（系统态显式 tenantId）。
 */
@Module({
  imports: [PrismaModule],
  controllers: [KbController],
  providers: [
    KbStoreService,
    KbLearningStoreService,
    KbRetrievalStoreService,
    KbService,
    DocParserService,
    EmbedService,
    QdrantService,
    KbLearningService,
    ChunkEmbedProcessor,
    KbRetrieverService,
  ],
  // DocParserService 导出供智搜补充上传（18 批 3）复用文档解析能力
  exports: [
    KbStoreService,
    KbLearningStoreService,
    KbRetrievalStoreService,
    KbService,
    KbLearningService,
    KbRetrieverService,
    DocParserService,
  ],
})
export class KbModule {}