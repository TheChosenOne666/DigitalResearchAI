import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AdminAuditService } from './admin-audit.service';
import { MeController } from './me.controller';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { AdminUsersController } from './users.controller';
import { AdminUsersService } from './users.service';
import { AdminMembersController } from './members.controller';
import { AdminMembersService } from './members.service';
import { AdminRolesController } from './roles.controller';
import { AdminRolesService } from './roles.service';
import { AdminIndicatorsController } from './indicators.controller';
import { AdminIndicatorsService } from './indicators.service';
import { AdminDictsController } from './dicts.controller';
import { AdminDictsService } from './dicts.service';
import { AdminDatasetsController } from './datasets.controller';
import { AdminDatasetsService } from './datasets.service';
import { AdminImportsController } from './imports.controller';
import { AdminImportsService } from './imports.service';
import { AdminNoticesController } from './notices.controller';
import { AdminNoticesService } from './notices.service';
import { AdminSearchOpsController } from './search-ops.controller';
import { AdminSearchOpsService } from './search-ops.service';

/**
 * 管理端模块（M6）：平台级跨租户应用。
 * - 统一注入 PrismaService 本体（系统 client，跨租户），不使用 forTenant（D1）
 * - 接口统一前缀 /api/v1/admin，各控制器按功能划分（D3）
 * - M6.1 装配当前用户上下文（/admin/me）与运营看板（/admin/dashboard）；
 *   M6.2 装配组织用户（A-02 用户管理 / A-03 会员管理 / A-04 角色权限）；
 *   M6.3 装配数据资源/数据治理/运营管理（A-05~A-10）；
 *   M6.4~M6.5 在 providers/controllers 中追加对应控制器与服务。
 */
@Module({
  imports: [PrismaModule],
  controllers: [
    MeController,
    DashboardController,
    AdminUsersController,
    AdminMembersController,
    AdminRolesController,
    AdminIndicatorsController,
    AdminDictsController,
    AdminDatasetsController,
    AdminImportsController,
    AdminNoticesController,
    AdminSearchOpsController,
  ],
  providers: [
    DashboardService,
    AdminAuditService,
    AdminUsersService,
    AdminMembersService,
    AdminRolesService,
    AdminIndicatorsService,
    AdminDictsService,
    AdminDatasetsService,
    AdminImportsService,
    AdminNoticesService,
    AdminSearchOpsService,
  ],
  exports: [AdminAuditService],
})
export class AdminModule {}
