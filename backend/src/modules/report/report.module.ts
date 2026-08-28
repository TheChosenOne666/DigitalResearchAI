import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { SearchModule } from '../search/search.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';

/**
 * 报告导出模块（M4.4）：
 * 复用 SearchStoreService（智搜报告 + {c:N} 引文）与 WorkspaceStoreService（分析结果报告），
 * 产出 Word/PPT 二进制流并落导出审计。
 */
@Module({
  imports: [PrismaModule, SearchModule, WorkspaceModule],
  controllers: [ReportController],
  providers: [ReportService],
})
export class ReportModule {}
