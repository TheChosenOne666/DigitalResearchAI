import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { ApiResponse, ErrorCode } from '@app/shared';

/**
 * 统一响应体拦截器：将控制器返回值包装为 { code, message, data }。
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => ({
        code: ErrorCode.OK,
        message: 'ok',
        data: data ?? null,
      })),
    );
  }
}
