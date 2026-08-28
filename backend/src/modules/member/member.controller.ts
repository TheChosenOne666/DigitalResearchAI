import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { getTenantContext } from '../../common/auth/tenant-context';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import { MemberService } from './member.service';

/** 自动续费开关入参 */
export interface AutoRenewBody {
  enabled?: unknown;
}

/**
 * 会员控制器（M5）：套餐查询、会员状态、连续包月开关。
 * 订单/支付接口见 order.controller.ts 与 pay.controller.ts。
 */
@Controller('member')
export class MemberController {
  constructor(private readonly member: MemberService) {}

  /** 当前用户 ID（受保护路由由全局守卫保证登录态） */
  private requireUserId(): string {
    const ctx = getTenantContext();
    if (!ctx) {
      throw new BizException(ErrorCode.UNAUTHORIZED, '未登录', HttpStatus.UNAUTHORIZED);
    }
    return ctx.userId;
  }

  /** 套餐列表（按等级分组，供会员中心三列卡片渲染） */
  @Get('plans')
  @HttpCode(HttpStatus.OK)
  plans() {
    return this.member.listPlans();
  }

  /** 当前会员状态（等级/周期/到期/剩余天数/免费体验剩余） */
  @Get('subscription')
  @HttpCode(HttpStatus.OK)
  subscription() {
    return this.member.getStatus(this.requireUserId());
  }

  /** 连续包月自动续费开关（仅对连续包月生效，其他周期也可提前设置） */
  @Post('subscription/auto-renew')
  @HttpCode(HttpStatus.OK)
  setAutoRenew(@Body() body: AutoRenewBody) {
    const enabled = body?.enabled === true || body?.enabled === 'true';
    return this.member.setAutoRenew(this.requireUserId(), enabled);
  }
}
