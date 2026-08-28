import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { getTenantContext } from '../../common/auth/tenant-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import { Prisma, UserStatus } from '../../generated/prisma/client';
import { parsePageParams, buildPageResult } from './pagination';
import type {
  AdminUserCreate,
  AdminUserUpdate,
  AdminUserStatus,
  AdminResetPassword,
  AdminUserRoles,
} from './dto';

/** 用户列表行（对外形状，含角色编码） */
export interface AdminUserRow {
  id: string;
  username: string | null;
  realName: string | null;
  nickname: string;
  phone: string;
  organization: string | null;
  status: string;
  roles: string[];
  createdAt: Date;
}

/** 用户列表筛选条件 */
export interface AdminUserListQuery {
  keyword?: string;
  role?: string;
  status?: string;
  page: number;
  pageSize: number;
}

/** 用户行转换：提取角色编码 */
function toUserRow(user: {
  id: string;
  username: string | null;
  realName: string | null;
  nickname: string;
  phone: string;
  organization: string | null;
  status: string;
  createdAt: Date;
  roles?: { role: { code: string } }[];
}): AdminUserRow {
  return {
    id: user.id,
    username: user.username,
    realName: user.realName,
    nickname: user.nickname,
    phone: user.phone,
    organization: user.organization,
    status: user.status,
    roles: (user.roles ?? []).map((r) => r.role.code),
    createdAt: user.createdAt,
  };
}

/**
 * 组织用户 · 用户管理服务（A-02）。
 * 平台级跨租户：注入 PrismaService 本体（系统 client），不做租户过滤（D1）。
 */
@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 当前操作用户 ID（受保护路由由全局守卫保证登录态） */
  private operatorId(): string {
    const ctx = getTenantContext();
    if (!ctx) {
      throw new BizException(ErrorCode.UNAUTHORIZED, '未登录', HttpStatus.UNAUTHORIZED);
    }
    return ctx.userId;
  }

  /** 用户列表（关键词/角色/状态筛选 + 分页） */
  async list(query: AdminUserListQuery) {
    const where: Prisma.UserWhereInput = {};
    const kw = query.keyword?.trim();
    if (kw) {
      where.OR = [
        { username: { contains: kw, mode: 'insensitive' } },
        { realName: { contains: kw, mode: 'insensitive' } },
        { nickname: { contains: kw, mode: 'insensitive' } },
        { phone: { contains: kw } },
      ];
    }
    if (query.role) {
      where.roles = { some: { role: { code: query.role } } };
    }
    if (query.status === 'ACTIVE' || query.status === 'DISABLED') {
      where.status = query.status;
    }

    const params = parsePageParams(String(query.page), String(query.pageSize));
    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        include: { roles: { include: { role: true } } },
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
    ]);
    return buildPageResult(rows.map(toUserRow), total, params);
  }

  /** 新增用户：校验手机号/用户名唯一 → 创建个人租户 + 用户 + 角色（事务） */
  async create(input: AdminUserCreate): Promise<AdminUserRow> {
    await this.assertPhoneUnique(input.phone);
    await this.assertUsernameUnique(input.username);

    const role = await this.prisma.role.findUnique({ where: { code: input.role } });
    if (!role) {
      throw new BizException(ErrorCode.NOT_FOUND, '角色不存在', HttpStatus.NOT_FOUND);
    }

    const { hash } = await import('bcryptjs');
    const passwordHash = await hash(input.password, 10);

    const user = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: input.organization || `${input.realName}的空间` },
      });
      return tx.user.create({
        data: {
          tenantId: tenant.id,
          phone: input.phone,
          nickname: input.realName || input.username,
          username: input.username,
          realName: input.realName,
          organization: input.organization ?? null,
          passwordHash,
          roles: { create: [{ roleId: role.id }] },
        },
        include: { roles: { include: { role: true } } },
      });
    });

    this.logger.log(`管理端新增用户: username=${input.username} id=${user.id}`);
    return toUserRow(user);
  }

  /** 编辑用户（不含密码与角色） */
  async update(id: string, input: AdminUserUpdate): Promise<AdminUserRow> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new BizException(ErrorCode.NOT_FOUND, '用户不存在', HttpStatus.NOT_FOUND);
    }
    await this.assertPhoneUnique(input.phone, id);
    await this.assertUsernameUnique(input.username, id);

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        username: input.username,
        realName: input.realName,
        phone: input.phone,
        organization: input.organization ?? null,
      },
      include: { roles: { include: { role: true } } },
    });
    this.logger.log(`管理端编辑用户: id=${id}`);
    return toUserRow(updated);
  }

  /** 禁用/启用（禁止禁用自己） */
  async setStatus(id: string, input: AdminUserStatus) {
    if (id === this.operatorId() && input.status === 'DISABLED') {
      throw new BizException(ErrorCode.CONFLICT, '不能禁用自己的账号', HttpStatus.CONFLICT);
    }
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new BizException(ErrorCode.NOT_FOUND, '用户不存在', HttpStatus.NOT_FOUND);
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: { status: input.status as UserStatus },
    });
    this.logger.log(`管理端${input.status === 'ACTIVE' ? '启用' : '禁用'}用户: id=${id}`);
    return { id: updated.id, status: updated.status };
  }

  /** 重置密码：更新哈希并写站内信通知（SYSTEM） */
  async resetPassword(id: string, input: AdminResetPassword) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new BizException(ErrorCode.NOT_FOUND, '用户不存在', HttpStatus.NOT_FOUND);
    }
    const { hash } = await import('bcryptjs');
    const passwordHash = await hash(input.newPassword, 10);
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    await this.prisma.message.create({
      data: {
        userId: id,
        title: '密码已重置',
        content: '您的账号密码已由管理员重置，请使用新密码登录。',
        type: 'SYSTEM',
      },
    });
    this.logger.log(`管理端重置密码: id=${id}`);
    return { ok: true };
  }

  /** 角色绑定：平台管理员至少保留 1 名 */
  async setRoles(id: string, input: AdminUserRoles) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { roles: { include: { role: true } } },
    });
    if (!user) {
      throw new BizException(ErrorCode.NOT_FOUND, '用户不存在', HttpStatus.NOT_FOUND);
    }

    const currentCodes = user.roles.map((r) => r.role.code);
    const targetCodes = [...new Set(input.roles)];
    // 移除平台管理员角色时，需保证系统仍保留至少 1 名
    if (currentCodes.includes('PLATFORM_ADMIN') && !targetCodes.includes('PLATFORM_ADMIN')) {
      const count = await this.prisma.userRole.count({
        where: { role: { code: 'PLATFORM_ADMIN' } },
      });
      if (count <= 1) {
        throw new BizException(ErrorCode.CONFLICT, '平台管理员至少保留 1 名', HttpStatus.CONFLICT);
      }
    }

    const roles = await this.prisma.role.findMany({ where: { code: { in: targetCodes } } });
    if (roles.length !== targetCodes.length) {
      throw new BizException(ErrorCode.NOT_FOUND, '存在无效角色', HttpStatus.NOT_FOUND);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({
        data: roles.map((r) => ({ userId: id, roleId: r.id })),
      });
    });
    this.logger.log(`管理端绑定角色: id=${id} roles=${targetCodes.join(',')}`);
    return { id, roles: targetCodes };
  }

  /** 手机号唯一性校验（排除指定用户） */
  private async assertPhoneUnique(phone: string, excludeId?: string): Promise<void> {
    const dup = await this.prisma.user.findFirst({
      where: { phone, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    });
    if (dup) {
      throw new BizException(ErrorCode.CONFLICT, '手机号已存在', HttpStatus.CONFLICT);
    }
  }

  /** 用户名唯一性校验（排除指定用户） */
  private async assertUsernameUnique(username: string, excludeId?: string): Promise<void> {
    const dup = await this.prisma.user.findFirst({
      where: { username, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    });
    if (dup) {
      throw new BizException(ErrorCode.CONFLICT, '用户名已存在', HttpStatus.CONFLICT);
    }
  }
}
