import { SetMetadata } from '@nestjs/common';

/** @Roles 元数据键：标记路由所需角色 */
export const ROLES_KEY = 'roles';

/** 内置三角色编码 */
export const RoleCode = {
  /** 普通用户 */
  USER: 'USER',
  /** 数据管理员 */
  DATA_ADMIN: 'DATA_ADMIN',
  /** 平台管理员 */
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
} as const;

export type RoleCodeValue = (typeof RoleCode)[keyof typeof RoleCode];

/** 声明访问该路由所需角色（任一满足即可）；未声明则仅要求已登录 */
export const Roles = (...roles: RoleCodeValue[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
