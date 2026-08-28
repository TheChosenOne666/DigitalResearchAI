import { Injectable, Logger } from '@nestjs/common';
import { ErrorCode, LoginResult } from '@app/shared';
import { BizException } from '../../common/exceptions/biz.exception';
import { SessionService } from '../../common/auth/session.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SmsCodeService } from './sms-code.service';

/** 内置角色编码（RBAC 三角色） */
export const ROLE_USER = 'USER';

/**
 * 认证服务：短信验证码登录（未注册自动创建）+ 账密登录 + 会话管理（Redis session）。
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly session: SessionService,
    private readonly sms: SmsCodeService,
  ) {}

  /** 查询用户（含角色编码），供登录复用 */
  private async findUserWithRoles(phone: string) {
    return this.prisma.user.findUnique({
      where: { phone },
      include: { roles: { include: { role: true } }, tenant: true },
    });
  }

  /** 登录成功：创建 Redis 会话并组装返回（sessionId + 用户信息） */
  private async buildLoginResult(user: {
    id: string;
    nickname: string;
    phone: string;
    tenantId: string;
    roles: { role: { code: string } }[];
  }): Promise<LoginResult> {
    const roles = user.roles.map((r) => r.role.code);
    const sessionId = await this.session.createSession({
      userId: user.id,
      tenantId: user.tenantId,
      roles,
    });
    return {
      sessionId,
      user: { id: user.id, nickname: user.nickname, phone: user.phone, roles },
    };
  }

  /** 短信验证码登录：校验验证码 → 未注册自动创建（个人租户 + USER 角色） */
  async smsLogin(phone: string, code: string): Promise<LoginResult> {
    await this.sms.verifyCode(phone, code);

    let user = await this.findUserWithRoles(phone);
    if (!user) {
      user = await this.createUserWithTenant(phone);
      this.logger.log(`新用户自动注册: phone=***${phone.slice(-4)} userId=${user.id}`);
    }
    this.assertActive(user);

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.auditLogin(user.id, user.tenantId, 'SMS');
    return this.buildLoginResult(user);
  }

  /**
   * 开发期免验证码登录（绕过短信 60s 限流，仅供联调/测试环境使用）。
   * 由 controller 用 DEV_LOGIN_ENABLED 环境变量守卫，生产环境不暴露。
   * 逻辑与 smsLogin 一致，仅跳过验证码校验。
   */
  async devLogin(phone: string): Promise<LoginResult> {
    let user = await this.findUserWithRoles(phone);
    if (!user) {
      user = await this.createUserWithTenant(phone);
      this.logger.log(`[DEV] 新用户自动注册: phone=***${phone.slice(-4)} userId=${user.id}`);
    }
    this.assertActive(user);

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.auditLogin(user.id, user.tenantId, 'DEV');
    this.logger.warn(`[DEV] 开发期免验证码登录: phone=***${phone.slice(-4)}`);
    return this.buildLoginResult(user);
  }

  /** 账号密码登录 */
  async passwordLogin(phone: string, password: string): Promise<LoginResult> {
    const user = await this.findUserWithRoles(phone);
    if (!user || !user.passwordHash) {
      throw new BizException(ErrorCode.LOGIN_FAILED, '账号或密码错误', 401);
    }
    this.assertActive(user);

    const { compare } = await import('bcryptjs');
    const ok = await compare(password, user.passwordHash);
    if (!ok) {
      throw new BizException(ErrorCode.LOGIN_FAILED, '账号或密码错误', 401);
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.auditLogin(user.id, user.tenantId, 'PASSWORD');
    return this.buildLoginResult(user);
  }

  /** 登出：销毁会话（幂等） */
  async logout(sessionId: string): Promise<void> {
    await this.session.destroySession(sessionId);
  }

  /** 禁用账号直接拒绝登录 */
  private assertActive(user: { status: string }): void {
    if (user.status !== 'ACTIVE') {
      throw new BizException(ErrorCode.ACCOUNT_DISABLED, '账号已被禁用', 403);
    }
  }

  /** 创建个人租户 + 用户 + 默认 USER 角色（事务） */
  private async createUserWithTenant(phone: string) {
    const [userRole] = await this.prisma.role.findMany({ where: { code: ROLE_USER }, take: 1 });
    if (!userRole) {
      throw new BizException(ErrorCode.INTERNAL_ERROR, '系统角色未初始化', 500);
    }
    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: `用户${phone.slice(-4)}的空间` },
      });
      return tx.user.create({
        data: {
          tenantId: tenant.id,
          phone,
          nickname: `用户${phone.slice(-4)}`,
          roles: { create: [{ roleId: userRole.id }] },
        },
        include: { roles: { include: { role: true } }, tenant: true },
      });
    });
  }

  /** 登录审计埋点（失败不阻塞主流程） */
  private async auditLogin(userId: string, tenantId: string, method: string): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'LOGIN',
          detail: { method },
        },
      });
    } catch (err) {
      this.logger.warn(`登录审计写入失败: ${(err as Error).message}`);
    }
  }
}
