import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * 健康检查模块：GET /api/v1/health。
 * 导出 HealthService 供管理端运行监控（A-14）复用真实探测（M6.4 / D5）。
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
