import { describe, expect, it } from 'vitest';
import { of } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';

describe('TransformInterceptor', () => {
  const interceptor = new TransformInterceptor();

  const mockContext = {} as ExecutionContext;
  const mockHandler = (data: unknown): CallHandler => ({ handle: () => of(data) });

  it('将控制器返回值包装为统一响应体 { code: 0, message: ok, data }', async () => {
    const result = await firstValueFrom(interceptor.intercept(mockContext, mockHandler({ foo: 1 })));
    expect(result).toEqual({ code: 0, message: 'ok', data: { foo: 1 } });
  });

  it('控制器返回 undefined 时 data 落为 null', async () => {
    const result = await firstValueFrom(interceptor.intercept(mockContext, mockHandler(undefined)));
    expect(result).toEqual({ code: 0, message: 'ok', data: null });
  });
});
