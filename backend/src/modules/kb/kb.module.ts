import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { KbController } from './kb.controller';
import { KbStoreService } from './store/kb.store.service';

/**
 * 知识库模块（M3.1 数据模型与 CRUD）。
 * 提供库/分组/文档的完整 CRUD 操作，全部经 PrismaService.forTenant 租户隔离。
 * M3.2 的文件解析与学习队列、M3.3 混合检索、M3.4 召回测试与入库链路将在此模块扩展。
 */
@Module({
  imports: [PrismaModule],
  controllers: [KbController],
  providers: [KbStoreService],
  exports: [KbStoreService],
})
export class KbModule {}