import { z } from 'zod';

/** 中国大陆手机号（11 位） */
const CN_PHONE_REGEX = /^1[3-9]\d{9}$/;

/** 6 位数字验证码 */
const SMS_CODE_REGEX = /^\d{6}$/;

/** 发送短信验证码请求 */
export const SmsSendSchema = z.object({
  /** 手机号 */
  phone: z.string().regex(CN_PHONE_REGEX, '手机号格式不正确'),
});

/** 短信验证码登录请求（未注册自动创建账号） */
export const SmsLoginSchema = z.object({
  /** 手机号 */
  phone: z.string().regex(CN_PHONE_REGEX, '手机号格式不正确'),
  /** 短信验证码 */
  code: z.string().regex(SMS_CODE_REGEX, '验证码为 6 位数字'),
});

/** 账号密码登录请求 */
export const PasswordLoginSchema = z.object({
  /** 登录账号（手机号） */
  phone: z.string().regex(CN_PHONE_REGEX, '手机号格式不正确'),
  /** 密码（6-64 位） */
  password: z.string().min(6, '密码至少 6 位').max(64, '密码最多 64 位'),
});

export type SmsSend = z.infer<typeof SmsSendSchema>;
export type SmsLogin = z.infer<typeof SmsLoginSchema>;
export type PasswordLogin = z.infer<typeof PasswordLoginSchema>;

/** 登录成功响应数据（Redis session 方案：返回 sessionId） */
export interface LoginResult {
  /** 会话 ID（后续请求 Authorization: Bearer <sessionId>） */
  sessionId: string;
  /** 用户信息 */
  user: {
    id: string;
    nickname: string;
    phone: string;
    /** 角色编码列表 */
    roles: string[];
  };
}
