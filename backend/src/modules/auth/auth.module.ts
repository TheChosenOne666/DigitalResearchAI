import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { SessionService } from '../../common/auth/session.service';
import { RedisSessionStore } from '../../common/auth/redis-session.store';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SmsCodeService, DEFAULT_SMS_POLICY } from './sms-code.service';
import { RedisSmsKvStore } from './redis-sms-kv.store';

/** 认证模块：验证码 + Redis session 会话 */
@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [
    RedisSessionStore,
    { provide: SessionService, useFactory: (store: RedisSessionStore) => new SessionService(store), inject: [RedisSessionStore] },
    RedisSmsKvStore,
    { provide: SmsCodeService, useFactory: (store: RedisSmsKvStore) => new SmsCodeService(store, DEFAULT_SMS_POLICY), inject: [RedisSmsKvStore] },
    AuthService,
  ],
})
export class AuthModule {}
