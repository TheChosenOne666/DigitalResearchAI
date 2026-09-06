import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

const backendDir = dirname(fileURLToPath(import.meta.url));

/**
 * 关键链路集成测试配置（独立于单测）：
 * - 独立测试库 ai_research_test + Redis db 1（见 test/integration/setup/env.ts）
 * - 运行方式：pnpm --filter @app/api test:integration（需 docker-compose 的 postgres/redis 在跑）
 * - 与单测隔离：CI/`pnpm test` 不含本目录，避免无数据库环境挂掉
 * - SWC 转换：vitest 默认 esbuild 不支持 emitDecoratorMetadata，Nest 依赖注入需要（.swcrc）
 */
export default defineConfig({
  plugins: [swc.vite()],
  resolve: {
    alias: {
      '@app/shared': resolve(backendDir, '../packages/shared/src/index.ts'),
    },
  },
  test: {
    include: ['test/integration/**/*.itest.ts'],
    environment: 'node',
    setupFiles: ['test/integration/setup/env.ts'],
    // 用例共享同一测试库与 Redis，禁用文件级并行
    fileParallelism: false,
    hookTimeout: 300_000,
    testTimeout: 30_000,
  },
});
