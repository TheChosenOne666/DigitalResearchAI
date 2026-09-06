import { describe, it, expect } from 'vitest';
import { validateEnv } from '../src/common/config/env.schema';

/** 最小合法环境（三个必填基础设施项） */
const VALID_ENV = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/ai_research',
  REDIS_URL: 'redis://localhost:6380',
  QDRANT_URL: 'http://localhost:6333',
};

describe('validateEnv 环境变量启动校验（高优先级优化 1）', () => {
  it('最小必填配置：校验通过并保留原值', () => {
    const env = validateEnv(VALID_ENV);
    expect(env.DATABASE_URL).toBe(VALID_ENV.DATABASE_URL);
    expect(env.APP_PORT).toBeUndefined();
  });

  it('缺 DATABASE_URL：抛错且错误信息包含字段名（fail-fast）', () => {
    const rest: Record<string, string> = { ...VALID_ENV };
    delete rest.DATABASE_URL;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('缺 REDIS_URL / QDRANT_URL：同样抛错', () => {
    expect(() => validateEnv({ ...VALID_ENV, REDIS_URL: undefined })).toThrow(/REDIS_URL/);
    expect(() => validateEnv({ ...VALID_ENV, QDRANT_URL: 'not-a-url' })).toThrow(/QDRANT_URL/);
  });

  it('RATE_SSE_MAX_CONCURRENT 非数字：抛错（防运行期才炸）', () => {
    expect(() => validateEnv({ ...VALID_ENV, RATE_SSE_MAX_CONCURRENT: 'abc' })).toThrow(
      /RATE_SSE_MAX_CONCURRENT/,
    );
  });

  it('RATE_SSE_MAX_CONCURRENT 为 0：抛错（并发上限必须为正整数）', () => {
    expect(() => validateEnv({ ...VALID_ENV, RATE_SSE_MAX_CONCURRENT: '0' })).toThrow(
      /RATE_SSE_MAX_CONCURRENT/,
    );
  });

  it('APP_PORT 越界（70000）：抛错', () => {
    expect(() => validateEnv({ ...VALID_ENV, APP_PORT: '70000' })).toThrow(/APP_PORT/);
  });

  it('布尔开关传非法值（DEV_LOGIN_ENABLED=yes）：抛错', () => {
    expect(() => validateEnv({ ...VALID_ENV, DEV_LOGIN_ENABLED: 'yes' })).toThrow(
      /DEV_LOGIN_ENABLED/,
    );
  });

  it('LOG_LEVEL 非法枚举：抛错', () => {
    expect(() => validateEnv({ ...VALID_ENV, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });

  it('可选数值配置合法（字符串被 coerce 为数字）：通过', () => {
    const env = validateEnv({
      ...VALID_ENV,
      APP_PORT: '3210',
      RATE_AUTH_RATE: '0.5',
      RATE_SSE_MAX_CONCURRENT: '5',
      SENTRY_TRACES_RATE: '0.1',
    });
    expect(env.APP_PORT).toBe(3210);
    expect(env.RATE_SSE_MAX_CONCURRENT).toBe(5);
  });
});
