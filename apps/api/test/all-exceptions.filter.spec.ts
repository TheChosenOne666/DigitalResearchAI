import { describe, expect, it } from 'vitest';
import { ArgumentsHost, ForbiddenException, NotFoundException } from '@nestjs/common';
import { z, ZodError } from 'zod';
import { ErrorCode } from '@app/shared';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

/** 构造模拟的 ArgumentsHost，捕获最终写出的 HTTP 状态与响应体 */
function createMockHost(): { host: ArgumentsHost; captured: { status?: number; body?: unknown } } {
  const captured: { status?: number; body?: unknown } = {};
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({
        status: (code: number) => {
          captured.status = code;
          return { json: (body: unknown) => (captured.body = body) };
        },
      }),
    }),
  } as unknown as ArgumentsHost;
  return { host, captured };
}

function zodError(): ZodError {
  const result = z.object({ verbose: z.string() }).safeParse({ verbose: 123 });
  return result.error as ZodError;
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('ZodError → 400 / 3001 参数校验失败', () => {
    const { host, captured } = createMockHost();
    filter.catch(zodError(), host);
    expect(captured.status).toBe(400);
    expect(captured.body).toEqual({ code: ErrorCode.VALIDATION_FAILED, message: expect.stringContaining('verbose'), data: null });
  });

  it('NotFoundException → 404 / 4001 资源不存在', () => {
    const { host, captured } = createMockHost();
    filter.catch(new NotFoundException('报告不存在'), host);
    expect(captured.status).toBe(404);
    expect(captured.body).toEqual({ code: ErrorCode.NOT_FOUND, message: '报告不存在', data: null });
  });

  it('ForbiddenException → 403 / 2001 无权限', () => {
    const { host, captured } = createMockHost();
    filter.catch(new ForbiddenException(), host);
    expect(captured.status).toBe(403);
    expect(captured.body).toEqual({ code: ErrorCode.FORBIDDEN, message: 'Forbidden', data: null });
  });

  it('未知异常 → 500 / 5001 服务内部错误', () => {
    const { host, captured } = createMockHost();
    filter.catch(new Error('boom'), host);
    expect(captured.status).toBe(500);
    expect(captured.body).toEqual({ code: ErrorCode.INTERNAL_ERROR, message: '服务内部错误', data: null });
  });
});
