import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ZodError } from 'zod';
import { ErrorCode, formatZodIssues } from '@app/shared';
import { BizException } from '../exceptions/biz.exception';

/** HTTP 状态码 → 业务错误码映射（1xxx 认证 / 2xxx 权限 / 4xxx 业务 / 5xxx 系统） */
function statusToErrorCode(status: number): number {
  if (status === HttpStatus.UNAUTHORIZED) return ErrorCode.UNAUTHORIZED;
  if (status === HttpStatus.FORBIDDEN) return ErrorCode.FORBIDDEN;
  if (status === HttpStatus.NOT_FOUND) return ErrorCode.NOT_FOUND;
  if (status === HttpStatus.CONFLICT) return ErrorCode.CONFLICT;
  if (status === HttpStatus.BAD_REQUEST) return ErrorCode.VALIDATION_FAILED;
  return ErrorCode.INTERNAL_ERROR;
}

/**
 * 全局异常过滤器：任何异常统一转换为 { code, message, data: null } 响应体。
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<{ status: (code: number) => { json: (body: unknown) => void } }>();

    let httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: number = ErrorCode.INTERNAL_ERROR;
    let message = '服务内部错误';

    if (exception instanceof ZodError) {
      // Zod 校验失败 → 400 / 3xxx
      httpStatus = HttpStatus.BAD_REQUEST;
      code = ErrorCode.VALIDATION_FAILED;
      message = formatZodIssues(exception.issues);
    } else if (exception instanceof BizException) {
      // 业务异常：透传业务码
      httpStatus = exception.getStatus();
      code = exception.bizCode;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      httpStatus = exception.getStatus();
      code = statusToErrorCode(httpStatus);
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else {
        const msg = (res as { message?: string | string[] }).message;
        message = Array.isArray(msg) ? msg.join('; ') : (msg ?? exception.message);
      }
    } else if (exception instanceof Error) {
      this.logger.error(`未捕获异常: ${exception.message}`, exception.stack);
    }

    response.status(httpStatus).json({ code, message, data: null });
  }
}
