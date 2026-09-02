import type { NextFunction, Request, Response } from 'express';
import pinoHttp from 'pino-http';
import { newRequestId, requestAls } from './request-context';
import { appLogger } from './app-logger';

/** 请求头中的透传 requestId 键（保留网关/上游传入） */
const REQUEST_ID_HEADER = 'x-request-id';

/**
 * 请求上下文中间件：
 * 1. 取上游 X-Request-Id 或生成新 requestId，回写响应头；
 * 2. AsyncLocalStorage 建立请求上下文（任意深度日志可取 requestId）；
 * 3. 包裹 pino-http 完成结构化访问日志（method/url/status/耗时，自动忽略 /metrics）。
 */
export function requestContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId =
    (req.headers[REQUEST_ID_HEADER] as string | undefined) || newRequestId();
  req.id = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  requestAls.run({ requestId }, () =>
    pinoHttp({
      logger: appLogger.pino,
      genReqId: () => requestId,
      autoLogging: {
        ignore: (r) => (r.url ?? '').includes('/metrics'),
      },
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password'],
        censor: '[REDACTED]',
      },
    })(req, res, next),
  );
}
