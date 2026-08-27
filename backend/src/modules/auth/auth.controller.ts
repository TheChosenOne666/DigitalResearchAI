import { Body, Controller, Post, Ip, HttpCode, Headers } from '@nestjs/common';
import {
  SmsSendSchema,
  SmsLoginSchema,
  PasswordLoginSchema,
  SmsSend,
  SmsLogin,
  PasswordLogin,
  LoginResult,
} from '@app/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../../common/auth/public.decorator';
import { AuthService } from './auth.service';
import { SmsCodeService } from './sms-code.service';

/** 从 Authorization 头解析 Bearer sessionId（会话型鉴权，对齐 docs/03-方案设计.md） */
export function extractSessionId(authorization?: string): string {
  if (!authorization) return '';
  const [scheme, credential] = authorization.split(' ');
  return scheme === 'Bearer' ? (credential ?? '') : '';
}

/**
 * 认证接口（对齐 docs/03-方案设计.md 核心接口清单）：
 * POST /api/v1/auth/sms/send    发送验证码
 * POST /api/v1/auth/sms/login   验证码登录（未注册自动创建）
 * POST /api/v1/auth/login       账密登录
 * POST /api/v1/auth/logout      登出（销毁会话）
 */
@Controller('auth')
@Public()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly smsCodeService: SmsCodeService,
  ) {}

  @Post('sms/send')
  @HttpCode(200)
  async sendSms(
    @Body(new ZodValidationPipe(SmsSendSchema)) body: SmsSend,
    @Ip() ip: string,
  ): Promise<{ sent: true }> {
    await this.smsCodeService.issueCode(body.phone, ip);
    // 实际短信发送（阿里云）在 M1 联调阶段接入；当前验证码仅写日志
    return { sent: true };
  }

  @Post('sms/login')
  @HttpCode(200)
  smsLogin(@Body(new ZodValidationPipe(SmsLoginSchema)) body: SmsLogin): Promise<LoginResult> {
    return this.authService.smsLogin(body.phone, body.code);
  }

  @Post('login')
  @HttpCode(200)
  passwordLogin(
    @Body(new ZodValidationPipe(PasswordLoginSchema)) body: PasswordLogin,
  ): Promise<LoginResult> {
    return this.authService.passwordLogin(body.phone, body.password);
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Headers('authorization') authorization?: string): Promise<{ loggedOut: true }> {
    await this.authService.logout(extractSessionId(authorization));
    return { loggedOut: true };
  }
}
