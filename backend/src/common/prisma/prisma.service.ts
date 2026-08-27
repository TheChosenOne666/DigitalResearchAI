import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { getTenantContext } from '../auth/tenant-context';
import { needsTenantFilter, applyTenantFilter } from './tenant-filter';

/** 租户隔离 client 类型（$extends 结果，去掉再扩展能力） */
type TenantScopedClient = Omit<PrismaClient, '$extends'>;

/**
 * Prisma 服务：全局单例 Client（Prisma 7 需通过 driver adapter 直连数据库）。
 * - `this`（继承 PrismaClient）：系统上下文，跨租户操作（登录查用户/审计写入等）
 * - `forTenant`：业务模块默认使用，租户 Extension 按当前请求上下文强制注入 tenant_id（ADR-2）
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /** 租户隔离 client：请求上下文存在时所有业务表查询强制带 tenant_id */
  readonly forTenant: TenantScopedClient;

  constructor(config: ConfigService) {
    const adapter = new PrismaPg({
      connectionString: config.get<string>(
        'DATABASE_URL',
        'postgresql://postgres:postgres@localhost:5433/ai_research',
      ),
    });
    super({ adapter });
    this.forTenant = this.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            const ctx = getTenantContext();
            if (ctx && needsTenantFilter(model, operation)) {
              return query(applyTenantFilter(args as Record<string, unknown>, operation, ctx.tenantId));
            }
            return query(args);
          },
        },
      },
    }) as unknown as TenantScopedClient;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
