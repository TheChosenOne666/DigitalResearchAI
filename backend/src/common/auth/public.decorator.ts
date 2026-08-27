import { SetMetadata } from '@nestjs/common';

/** @Public 元数据键：标记无需登录的公开路由 */
export const IS_PUBLIC_KEY = 'isPublic';

/** 标记路由为公开（跳过会话认证与角色校验），如登录/健康检查 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
