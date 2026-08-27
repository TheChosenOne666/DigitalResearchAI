import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * 健康检查模块：GET /api/v1/health。
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
