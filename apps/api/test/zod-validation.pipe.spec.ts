import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { HealthQuerySchema } from '@app/shared';
import { ZodValidationPipe } from '../src/common/pipes/zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(HealthQuerySchema);

  it('合法输入通过校验并应用 transform（verbose 字符串转布尔）', () => {
    expect(pipe.transform({ verbose: 'true' }, {} as never)).toEqual({ verbose: true });
    expect(pipe.transform({}, {} as never)).toEqual({ verbose: false });
  });

  it('非法输入抛出 BadRequestException 且信息包含字段路径', () => {
    expect(() => pipe.transform({ verbose: 123 }, {} as never)).toThrow(BadRequestException);
    try {
      pipe.transform({ verbose: 123 }, {} as never);
    } catch (err) {
      expect((err as BadRequestException).message).toContain('verbose');
    }
  });

  it('嵌套对象校验失败的错误信息拼接多个 issue', () => {
    const schema = z.object({ a: z.string(), b: z.number() });
    const nestedPipe = new ZodValidationPipe(schema);
    try {
      nestedPipe.transform({ a: 1, b: 'x' }, {} as never);
      expect.unreachable('应当抛出异常');
    } catch (err) {
      const message = (err as BadRequestException).message as string;
      expect(message).toContain('a');
      expect(message).toContain('b');
    }
  });
});
