import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Public } from '../../../common/auth/public.decorator';
import { PayService } from './pay.service';
import type { NotifyPayload } from './pay-channel';

/**
 * 支付回调控制器（M5.2）：渠道异步通知入口。
 * 无登录态（渠道服务器直连），故标记 @Public；报文合法性由渠道适配器验签保证。
 */
@Controller('pay')
export class PayController {
  constructor(private readonly payService: PayService) {}

  /**
   * 渠道支付回调：验签 → 幂等 → 入账 → 会员生效。
   * 返回 `{ ok: true }` 渠道即停止重试；验签失败返回 400 由渠道重试或告警。
   */
  @Public()
  @Post('notify/:channel')
  @HttpCode(HttpStatus.OK)
  notify(@Param('channel') channel: string, @Body() payload: NotifyPayload) {
    return this.payService.handleNotify(channel, payload);
  }
}
