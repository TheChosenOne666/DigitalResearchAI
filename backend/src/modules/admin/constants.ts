import { RoleCode } from '../../common/auth/roles.decorator';

/** 管理端列表默认分页大小 */
export const DEFAULT_PAGE_SIZE = 20;

/** 管理端列表单页上限 */
export const MAX_PAGE_SIZE = 100;

/** 可进入管理端的角色（普通用户无管理端权限） */
export const ADMIN_ROLES: string[] = [RoleCode.PLATFORM_ADMIN, RoleCode.DATA_ADMIN];

/** 仅平台管理员可访问的模块角色声明 */
export const PLATFORM_ONLY: string[] = [RoleCode.PLATFORM_ADMIN];

/** 平台管理员 + 数据管理员均可访问的模块角色声明 */
export const PLATFORM_AND_DATA: string[] = [RoleCode.PLATFORM_ADMIN, RoleCode.DATA_ADMIN];

/** 管理端菜单项 */
export interface AdminMenuItem {
  /** 唯一键（与前端路由名一致） */
  key: string;
  /** 菜单名 */
  label: string;
  /** 前端路由路径 */
  path: string;
  /** 可见角色（任一满足即展示） */
  roles: string[];
}

/** 管理端菜单分组（对齐原型侧栏分组与 A-04 权限矩阵） */
export interface AdminMenuGroup {
  /** 分组键 */
  key: string;
  /** 分组名 */
  label: string;
  /** 分组下菜单项 */
  items: AdminMenuItem[];
}

/**
 * 管理端菜单（原型 A-01 ~ A-20）。
 * 权限矩阵：数据管理员仅可见数据资源 / 数据治理 / 任务中心；
 * 组织用户 / 运营管理 / 系统管理 / 知识库管理 / 支付中心仅平台管理员可见。
 */
export const ADMIN_MENUS: AdminMenuGroup[] = [
  {
    key: 'dashboard',
    label: '运营看板',
    items: [{ key: 'dashboard', label: '平台总览', path: '/dashboard', roles: PLATFORM_AND_DATA }],
  },
  {
    key: 'org',
    label: '组织用户',
    items: [
      { key: 'users', label: '用户管理', path: '/users', roles: PLATFORM_ONLY },
      { key: 'members', label: '会员管理', path: '/members', roles: PLATFORM_ONLY },
      { key: 'roles', label: '角色权限', path: '/roles', roles: PLATFORM_ONLY },
    ],
  },
  {
    key: 'data',
    label: '数据资源',
    items: [
      { key: 'indicators', label: '指标管理', path: '/indicators', roles: PLATFORM_AND_DATA },
      { key: 'dicts', label: '字典管理', path: '/dicts', roles: PLATFORM_AND_DATA },
      { key: 'datasets', label: '数据集管理', path: '/datasets', roles: PLATFORM_AND_DATA },
    ],
  },
  {
    key: 'governance',
    label: '数据治理',
    items: [
      { key: 'imports', label: '数据接入审核', path: '/imports', roles: PLATFORM_AND_DATA },
    ],
  },
  {
    key: 'ops',
    label: '运营管理',
    items: [
      { key: 'notices', label: '消息管理', path: '/notices', roles: PLATFORM_ONLY },
      { key: 'search-ops', label: '搜索词管理', path: '/search-ops', roles: PLATFORM_ONLY },
    ],
  },
  {
    key: 'tasks',
    label: '任务中心',
    items: [{ key: 'tasks', label: '任务管理', path: '/tasks', roles: PLATFORM_AND_DATA }],
  },
  {
    key: 'system',
    label: '系统管理',
    items: [
      { key: 'config', label: '参数配置', path: '/config', roles: PLATFORM_ONLY },
      { key: 'audit', label: '审计日志', path: '/audit', roles: PLATFORM_ONLY },
      { key: 'monitor', label: '运行监控', path: '/monitor', roles: PLATFORM_ONLY },
      { key: 'backup', label: '数据备份', path: '/backup', roles: PLATFORM_ONLY },
    ],
  },
  {
    key: 'kb',
    label: '知识库管理',
    items: [
      { key: 'kb-review', label: '入库审核', path: '/kb/review', roles: PLATFORM_ONLY },
      { key: 'kb-category', label: '知识分类', path: '/kb/category', roles: PLATFORM_ONLY },
      { key: 'kb-permission', label: '知识权限', path: '/kb/permission', roles: PLATFORM_ONLY },
      { key: 'kb-index', label: '索引管理', path: '/kb/index', roles: PLATFORM_ONLY },
    ],
  },
  {
    key: 'pay',
    label: '支付中心',
    items: [{ key: 'orders', label: '订单与支付渠道', path: '/orders', roles: PLATFORM_ONLY }],
  },
];

/**
 * 按角色过滤管理端菜单（空分组剔除）。
 * @param roles 当前用户角色编码列表
 */
export function filterAdminMenus(roles: string[]): AdminMenuGroup[] {
  return ADMIN_MENUS.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.roles.some((r) => roles.includes(r))),
  })).filter((group) => group.items.length > 0);
}

/** 任务状态展示文案（A-11） */
export const TASK_STATUS_TEXT: Record<string, string> = {
  WAITING: '待执行',
  RUNNING: '执行中',
  SUCCESS: '成功',
  FAILED: '失败',
  STOPPED: '已终止',
};

/** 任务类型展示文案（A-11 / A-15 / A-19 共用） */
export const TASK_TYPE_TEXT: Record<string, string> = {
  SEARCH: '检索',
  COLLECT: '采集',
  ANALYZE: '分析',
  REPORT: '报告',
  INDEX: '索引',
  BACKUP: '备份',
};

/** 内置角色说明（A-04 角色权限页，静态常量，一期不开放自定义角色） */
export const BUILTIN_ROLES: Array<{ code: string; name: string; description: string }> = [
  {
    code: 'PLATFORM_ADMIN',
    name: '平台管理员',
    description: '拥有管理端全部功能权限及用户端全部功能权限（含系统管理、支付配置等）。',
  },
  {
    code: 'DATA_ADMIN',
    name: '数据管理员',
    description: '拥有数据资源、数据治理、任务中心等数据类功能权限。',
  },
  {
    code: 'USER',
    name: '普通用户',
    description: '拥有用户端全部功能权限（不含管理端）。',
  },
];

/** 权限矩阵行（A-04 权限矩阵表） */
export interface PermissionMatrixRow {
  /** 模块说明 */
  module: string;
  /** 各角色是否拥有该模块权限 */
  PLATFORM_ADMIN: boolean;
  DATA_ADMIN: boolean;
  USER: boolean;
}

/** 权限矩阵（A-04，静态常量，对齐原型 4 行） */
export const PERMISSION_MATRIX: PermissionMatrixRow[] = [
  { module: '用户端（检索 / 分析 / 报告 / 知识库 / 个人中心 / 支付）', PLATFORM_ADMIN: true, DATA_ADMIN: true, USER: true },
  { module: '管理端 · 数据资源 / 数据治理 / 任务中心', PLATFORM_ADMIN: true, DATA_ADMIN: true, USER: false },
  { module: '管理端 · 组织用户 / 运营管理', PLATFORM_ADMIN: true, DATA_ADMIN: false, USER: false },
  { module: '管理端 · 系统管理 / 知识库管理 / 支付中心', PLATFORM_ADMIN: true, DATA_ADMIN: false, USER: false },
];
