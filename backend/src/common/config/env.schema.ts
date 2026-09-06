import { z } from 'zod';

/**
 * 环境变量启动校验 schema（高优先级优化 1）：ConfigModule validate 钩子使用。
 * - 必填项缺失或格式非法：进程启动即失败并打印具体字段（fail-fast），
 *   避免配置错误潜伏到运行期才在某个请求路径上炸出
 * - 可选项：带类型与默认值校验（端口/限流阈值/备份容器名等）
 *
 * 约定：新增环境变量时同步维护本 schema 与 backend/.env.example。
 */

/** 端口：1-65535 整数（字符串形态，env 均为字符串） */
const portSchema = z.coerce.number().int().min(1).max(65535);

/** 正整数（并发上限等） */
const posInt = z.coerce.number().int().min(1);

/** URL 形态（redis:// http(s):// 均允许由具体字段约束） */
const urlSchema = z.string().url();

/** 布尔开关（'true' / 'false'，缺省按各自默认值） */
const boolStr = z.enum(['true', 'false']).optional();

/**
 * 全量环境变量 schema。
 * 必填：DATABASE_URL / REDIS_URL / QDRANT_URL（缺任何一个启动即失败）。
 * 其余为可选：未配置时走默认值，配置了但类型非法时启动失败。
 */
export const envSchema = z.object({
  // ── 基础设施（必填） ──────────────────────────────────────────
  DATABASE_URL: urlSchema,
  REDIS_URL: urlSchema,
  QDRANT_URL: urlSchema,

  // ── 服务 ─────────────────────────────────────────────────────
  APP_PORT: portSchema.optional(),

  // ── 外部服务 Key（可空字符串，业务层已有降级逻辑） ────────────
  ARK_API_KEY: z.string().optional(),
  EMBED_MODEL: z.string().optional(),
  ANYSEARCH_API_KEY: z.string().optional(),
  ANYSEARCH_BASE_URL: urlSchema.optional(),
  SECRET_ENC_KEY: z.string().optional(),

  // ── 登录/开发后门 ────────────────────────────────────────────
  DEV_LOGIN_ENABLED: boolStr,

  // ── 限流（M7.2 令牌桶，均为兜底默认值） ────────────────────────
  RATE_LIMIT_ENABLED: boolStr,
  RATE_AUTH_RATE: z.coerce.number().positive().optional(),
  RATE_AUTH_BURST: posInt.optional(),
  RATE_GLOBAL_RATE: z.coerce.number().positive().optional(),
  RATE_GLOBAL_BURST: posInt.optional(),
  RATE_SSE_MAX_CONCURRENT: posInt.optional(),

  // ── 备份（M7.4 docker exec pg_dump） ──────────────────────────
  BACKUP_DIR: z.string().optional(),
  BACKUP_PG_CONTAINER: z.string().min(1).optional(),
  BACKUP_PG_USER: z.string().min(1).optional(),
  BACKUP_PG_DB: z.string().min(1).optional(),

  // ── 可观测性（M7.1） ──────────────────────────────────────────
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional(),
  LOG_PRETTY: boolStr,
  SENTRY_DSN: urlSchema.optional(),
  SENTRY_TRACES_RATE: z.coerce.number().min(0).max(1).optional(),
  OTEL_ENABLED: boolStr,
  OTEL_EXPORTER_OTLP_ENDPOINT: urlSchema.optional(),

  // ── 支付 mock ─────────────────────────────────────────────────
  PAY_MOCK_SECRET: z.string().optional(),
});

/** 校验通过后的强类型环境变量 */
export type Env = z.infer<typeof envSchema>;

/**
 * ConfigModule.validate 钩子：校验失败抛出含各字段错误详情的异常，
 * 使 NestFactory 在监听端口前终止进程（bufferLogs 场景下由引导日志打印）。
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`环境变量校验失败（检查 .env / 部署环境配置）：\n${issues}`);
  }
  return parsed.data;
}
