import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { finalize, Observable } from 'rxjs';
import { MetricsService } from './metrics.service';

/**
 * HTTP 时延指标拦截器（M7.1）：
 * route 取控制器路径模板（req.route.path），避免带 id 的原始 URL 造成高基数；
 * 经 finalize 记录，SSE 等长连接在流结束时统计总耗时。
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<{ method: string; path: string; route?: { path: string }; baseUrl?: string }>();
    const started = process.hrtime.bigint();

    return next.handle().pipe(
      finalize(() => {
        const res = http.getResponse<{ statusCode?: number }>();
        const route = req.route?.path ? `${req.baseUrl ?? ''}${req.route.path}` : 'unmatched';
        const seconds = Number(process.hrtime.bigint() - started) / 1e9;
        this.metrics.observeHttp(route, req.method, res.statusCode ?? 0, seconds);
      }),
    );
  }
}
