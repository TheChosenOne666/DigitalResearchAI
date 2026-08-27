import { Controller, Get, Query } from '@nestjs/common';
import { HealthQuery, HealthQuerySchema, HealthData } from '@app/shared';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import { Public } from '../auth/public.decorator';
import { HealthService } from './health.service';

/**
 * 健康检查接口：GET /api/v1/health?verbose=true。
 */
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getHealth(
    @Query(new ZodValidationPipe(HealthQuerySchema)) query: HealthQuery,
  ): Promise<HealthData> {
    return this.healthService.check(query.verbose);
  }
}
