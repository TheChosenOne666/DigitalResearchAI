import { Body, Controller, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { RoleCode, Roles } from '../../common/auth/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminConfigsService } from './configs.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminConfigUpdateSchema } from './dto';
import type { AdminConfigUpdate } from './dto';

/**
 * 系统管理 · 参数配置（A-12）：参数列表 + 热更新（范围校验）。
 * 仅平台管理员可访问；修改即时生效并记录审计（A-13）。
 */
@Controller('admin/configs')
@Roles(RoleCode.PLATFORM_ADMIN)
export class AdminConfigsController {
  constructor(
    private readonly configs: AdminConfigsService,
    private readonly audit: AdminAuditService,
  ) {}

  /** 参数列表 */
  @Get()
  @HttpCode(HttpStatus.OK)
  list() {
    return this.configs.list();
  }

  /** 更新参数值 */
  @Put(':key')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(AdminConfigUpdateSchema)) body: AdminConfigUpdate,
  ) {
    const row = await this.configs.update(key, body.value);
    await this.audit.record({ targetType: 'SYS_CONFIG', targetId: key, detail: { value: body.value } });
    return row;
  }
}
