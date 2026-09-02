import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { MetricsService } from './metrics.service';

/**
 * Prometheus 抓取端点（M7.1）：GET /api/v1/metrics，text/plain 原样输出。
 * @Public 免会话（Prometheus 无登录态）；生产环境由 Nginx 限内网访问。
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Public()
  @Get()
  async get(@Res() res: Response): Promise<void> {
    res.type(this.metrics.contentType).send(await this.metrics.text());
  }
}
