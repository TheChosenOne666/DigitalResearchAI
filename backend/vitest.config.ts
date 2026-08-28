import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const backendDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // 测试直接解析 shared 源码，避免依赖 build 产物（CI 上 test 先于 build 执行，无 dist）
      '@app/shared': resolve(backendDir, '../packages/shared/src/index.ts'),
    },
  },
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
  },
});
