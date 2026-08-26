import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

/**
 * Prisma 服务：全局单例 Client（Prisma 7 需通过 driver adapter 直连数据库）。
 * 租户强制隔离的 Client Extension 将在 M1 后续接入（tenant 中间件完成后）。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService) {
    const adapter = new PrismaPg({
      connectionString: config.get<string>(
        'DATABASE_URL',
        'postgresql://postgres:postgres@localhost:5433/ai_research',
      ),
    });
    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
