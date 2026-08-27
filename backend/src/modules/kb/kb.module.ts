import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { KbController } from './kb.controller';
import { KbService } from './kb.service';
import { KbStoreService } from './store/kb.store.service';
import { DocParserService } from './parse/doc-parser.service';
import { EmbedService } from './embeddings/embed.service';
import { QdrantService } from './vector/qdrant.service';
import { KbLearningService } from './learning/learning.service';
import { ChunkEmbedProcessor } from './queue/chunk-embed.processor';

/**
 * 知识库模块。
 * M3.1：库/分组/文档 CRUD；M3.2：上传解析 + 学习队列（DocParser/Embed/Qdrant/Learning/ChunkEmbedProcessor）。
 */
@Module({
  imports: [PrismaModule],
  controllers: [KbController],
  providers: [
    KbStoreService,
    KbService,
    DocParserService,
    EmbedService,
    QdrantService,
    KbLearningService,
    ChunkEmbedProcessor,
  ],
  exports: [KbStoreService, KbLearningService],
})
export class KbModule {}