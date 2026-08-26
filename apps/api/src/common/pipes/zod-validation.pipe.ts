import { ArgumentMetadata, BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodTypeDef, ZodType } from 'zod';
import { formatZodIssues } from '@app/shared';

/**
 * Zod 校验管道：在路由参数上显式使用，如 @Query(new ZodValidationPipe(Schema))。
 * 校验失败抛出 BadRequestException，由全局异常过滤器统一转换为 3xxx 响应。
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(formatZodIssues(result.error.issues));
    }
    return result.data;
  }
}
