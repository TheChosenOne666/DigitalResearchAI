import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Prisma 全局模块：业务模块统一注入 PrismaService */
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
