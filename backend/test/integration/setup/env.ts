import { readFileSync } from 'node:fs';

/**
 * 集成测试环境变量（setupFiles，先于 AppModule 静态导入执行）。
 * 从 backend/.env 派生测试专用连接（独立库 ai_research_test + Redis db 1），
 * 不硬编码密钥；process.env 优先级高于 ConfigModule 的 .env 文件加载。
 */

function readDotEnv(key: string): string {
  try {
    const text = readFileSync(new URL('../../.env', import.meta.url), 'utf-8');
    const m = new RegExp(`^${key}=(.*)$`, 'm').exec(text);
    return m?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}

const devDatabaseUrl =
  process.env.DATABASE_URL || readDotEnv('DATABASE_URL') || 'postgresql://postgres:postgres@localhost:5433/ai_research';
const devRedisUrl = process.env.REDIS_URL || readDotEnv('REDIS_URL') || 'redis://localhost:6380';

/** 测试库连接串（独立库，避免污染开发库） */
export const INTEGRATION_DB_URL = devDatabaseUrl.replace(/\/ai_research(\?.*)?$/, '/ai_research_test$1');
/** 测试 Redis（db 1，与开发 db 0 隔离；用例间 flushdb） */
export const INTEGRATION_REDIS_URL = /\/\d+$/.test(devRedisUrl)
  ? devRedisUrl.replace(/\/\d+$/, '/1')
  : `${devRedisUrl}/1`;

process.env.DATABASE_URL = INTEGRATION_DB_URL;
process.env.REDIS_URL = INTEGRATION_REDIS_URL;
process.env.QDRANT_URL = process.env.QDRANT_URL || readDotEnv('QDRANT_URL') || 'http://localhost:6333';
// dev-login 仅供联调/测试环境使用，测试环境显式开启
process.env.DEV_LOGIN_ENABLED = 'true';
// 外部 LLM 一律不真调：未配置 Key 时走生产同款降级链路（意图跳过回填、生成输出降级正文）
delete process.env.ARK_API_KEY;
