import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 业务异常：携带具体业务错误码（ErrorCode），由全局异常过滤器透传给前端。
 */
export class BizException extends HttpException {
  /** 业务错误码（见 @app/shared ErrorCode） */
  readonly bizCode: number;

  constructor(bizCode: number, message: string, httpStatus = HttpStatus.BAD_REQUEST) {
    super(message, httpStatus);
    this.bizCode = bizCode;
  }
}
