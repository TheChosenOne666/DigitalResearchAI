import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../src/generated/prisma/client';

/** 集成测试独立库名（与开发库 ai_research 隔离） */
export const TEST_DB_NAME = 'ai_research_test';

const backendDir = fileURLToPath(new URL('../../..', import.meta.url));

/** 由基础连接串替换库名 */
function withDbName(baseUrl: string, dbName: string): string {
  return baseUrl.replace(/\/[^/?]+(\?.*)?$/, `/${dbName}$1`);
}

/**
 * 确保测试库存在（幂等：已存在跳过创建），返回测试库连接串。
 * 通过管理库（postgres）执行 CREATE DATABASE，Prisma 驱动适配器直连。
 */
export async function ensureDatabase(devDatabaseUrl: string): Promise<string> {
  const testUrl = withDbName(devDatabaseUrl, TEST_DB_NAME);
  const adminUrl = withDbName(devDatabaseUrl, 'postgres');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl }) });
  try {
    await client.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB_NAME}"`);
  } catch (e) {
    // 42P04 duplicate_database：库已存在即幂等通过
    const code = (e as { code?: string }).code;
    const msg = e instanceof Error ? e.message : String(e);
    if (code !== '42P04' && !msg.includes('already exists')) throw e;
  } finally {
    await client.$disconnect();
  }
  return testUrl;
}

/** 在测试库上执行 prisma migrate deploy（同步阻塞，仅 setup 阶段调用） */
export function runMigrateDeploy(databaseUrl: string): void {
  const r = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { cwd: backendDir, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'inherit' },
  );
  if (r.status !== 0) throw new Error(`prisma migrate deploy 失败（exit ${r.status}）`);
}

/** 在测试库上执行种子（seed-admin 幂等：角色/管理员/系统参数/字典/指标/支付渠道） */
export function runSeedAdmin(databaseUrl: string): void {
  const r = spawnSync(process.execPath, ['prisma/seed-admin.ts'], {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error(`seed-admin 失败（exit ${r.status}）`);
}
