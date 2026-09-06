import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { MemberController } from './member.controller';
import { MemberService } from './member.service';
import { PlanStoreService } from './plan.store.service';
import { OrderStoreService } from './order.store.service';
import { SubscriptionStoreService } from './subscription.store.service';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { QuotaService } from './quota.service';
import { BillingController } from './billing.controller';
import { PayController } from './pay/pay.controller';
import { PayService } from './pay/pay.service';
import { MockPayChannel } from './pay/mock.channel';
import { PayChannelRegistry } from './pay/pay-channel';

/**
 * 会员计费模块（M5）：
 * M5.1 套餐与会员状态；M5.2 订单状态机 + 支付渠道适配 + 账单；M5.3 免费体验配额（供智搜复用）。
 * 支付渠道适配器在此注册——接入微信/支付宝时只需新增 provider 并加入注册表。
 * 持久化按域拆分：PlanStore（平台级套餐）/ OrderStore（订单+流水）/ SubscriptionStore（订阅+配额）。
 */
@Module({
  imports: [PrismaModule],
  controllers: [MemberController, OrderController, BillingController, PayController],
  providers: [
    PlanStoreService,
    OrderStoreService,
    SubscriptionStoreService,
    MemberService,
    OrderService,
    PayService,
    QuotaService,
    MockPayChannel,
    {
      provide: PayChannelRegistry,
      useFactory: (mock: MockPayChannel) => new PayChannelRegistry([mock]),
      inject: [MockPayChannel],
    },
  ],
  exports: [MemberService, PlanStoreService, OrderStoreService, SubscriptionStoreService, QuotaService],
})
export class MemberModule {}
