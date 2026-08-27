import { Module } from '@nestjs/common';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';

/**
 * 数据工作台模块（M4.1）：时序数据查询。
 * M4.2 起追加上传补充、图表数据、分析结果、我的数据/我的报告能力。
 */
@Module({
  controllers: [WorkspaceController],
  providers: [WorkspaceService],
})
export class WorkspaceModule {}
