import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RateLimitStore, RedisRateLimitStore } from './rate-limit.store';
import { RateLimitService } from './rate-limit.service';
import { RateLimitGuard } from './rate-limit.guard';

/**
 * 限流模块（M7.2，全局）：令牌桶速率限流 + SSE 并发槽位。
 * RateLimitService 全局单例，各业务模块直接注入；
 * RateLimitGuard 需在 AppModule 以 APP_GUARD 注册（SessionAuthGuard 之后）。
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    { provide: RateLimitStore, useClass: RedisRateLimitStore },
    RateLimitService,
    RateLimitGuard,
  ],
  exports: [RateLimitService, RateLimitGuard],
})
export class RateLimitModule {}
