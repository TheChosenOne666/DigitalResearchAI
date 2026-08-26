/**
 * 统一错误码（分段规则见 docs/03-方案设计.md 第三节）：
 * 0 成功 / 1xxx 认证 / 2xxx 权限租户 / 3xxx 参数 / 4xxx 业务 / 5xxx 系统
 */
export const ErrorCode = {
  /** 成功 */
  OK: 0,
  /* ---- 1xxx 认证 ---- */
  /** 未登录 */
  UNAUTHORIZED: 1001,
  /** 会话无效或已过期 */
  INVALID_SESSION: 1002,
  /** 验证码错误或已过期 */
  SMS_CODE_INVALID: 1005,
  /** 验证码发送过频（60s 内重复发送） */
  SMS_CODE_TOO_FREQUENT: 1006,
  /** 验证码发送次数超限（IP/手机号维度限流） */
  SMS_SEND_LIMIT_EXCEEDED: 1007,
  /** 账号或密码错误 */
  LOGIN_FAILED: 1008,
  /** 账号已被禁用 */
  ACCOUNT_DISABLED: 1009,
  /* ---- 2xxx 权限与租户 ---- */
  /** 无权限访问该资源 */
  FORBIDDEN: 2001,
  /** 跨租户访问被拒绝 */
  CROSS_TENANT_DENIED: 2002,
  /* ---- 3xxx 参数 ---- */
  /** 参数校验失败 */
  VALIDATION_FAILED: 3001,
  /** 缺少必填参数 */
  PARAM_MISSING: 3002,
  /* ---- 4xxx 业务 ---- */
  /** 资源不存在 */
  NOT_FOUND: 4001,
  /** 资源已存在 / 冲突 */
  CONFLICT: 4002,
  /** 配额已用尽 */
  QUOTA_EXCEEDED: 4003,
  /* ---- 5xxx 系统 ---- */
  /** 服务内部错误 */
  INTERNAL_ERROR: 5001,
  /** 依赖服务不可用 */
  DEPENDENCY_UNAVAILABLE: 5002,
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
