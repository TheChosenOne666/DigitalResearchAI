import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 配置：连接串与迁移目录集中在此（schema datasource 不再支持 url）。
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/ai_research',
  },
});
