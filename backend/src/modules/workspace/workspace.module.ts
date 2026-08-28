import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { KbModule } from '../kb/kb.module';
import { SearchModule } from '../search/search.module';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import { WorkspaceStoreService } from './workspace.store.service';
import { AnalyzeService } from './analyze.service';

/**
 * 数据工作台模块（M4）：
 * M4.1 时序数据查询；M4.2 上传补充 + 图表数据；M4.3 分析结果生成（复用 GenerateService + Kb 存库链路）。
 */
@Module({
  imports: [PrismaModule, KbModule, SearchModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceService, WorkspaceStoreService, AnalyzeService],
  exports: [WorkspaceStoreService],
})
export class WorkspaceModule {}
