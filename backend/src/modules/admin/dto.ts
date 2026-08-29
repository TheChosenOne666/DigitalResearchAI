import { z } from 'zod';

/** 中国大陆手机号（与 auth.dto 保持一致） */
const PHONE_REGEX = /^1[3-9]\d{9}$/;

/** 内置角色编码（三角色） */
const ROLE_ENUM = z.enum(['USER', 'DATA_ADMIN', 'PLATFORM_ADMIN']);

/** 新增用户（A-02）：用户名 / 姓名 / 手机号 / 组织 / 角色 / 初始密码 */
export const AdminUserCreateSchema = z.object({
  /** 用户名（唯一） */
  username: z.string().min(2, '用户名至少 2 位').max(32, '用户名最多 32 位'),
  /** 姓名 */
  realName: z.string().min(1, '姓名不能为空').max(64, '姓名最多 64 位'),
  /** 手机号（登录账号，唯一） */
  phone: z.string().regex(PHONE_REGEX, '手机号格式不正确'),
  /** 所属组织（自由文本，可空） */
  organization: z.string().max(128, '组织最多 128 位').optional(),
  /** 角色编码（默认普通用户） */
  role: ROLE_ENUM.default('USER'),
  /** 初始密码 */
  password: z.string().min(6, '密码至少 6 位').max(64, '密码最多 64 位'),
});

/** 编辑用户（A-02，不含密码与角色） */
export const AdminUserUpdateSchema = z.object({
  username: z.string().min(2, '用户名至少 2 位').max(32, '用户名最多 32 位'),
  realName: z.string().min(1, '姓名不能为空').max(64, '姓名最多 64 位'),
  phone: z.string().regex(PHONE_REGEX, '手机号格式不正确'),
  organization: z.string().max(128, '组织最多 128 位').optional(),
});

/** 用户状态切换（A-02） */
export const AdminUserStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'DISABLED']),
});

/** 重置密码（A-02） */
export const AdminResetPasswordSchema = z.object({
  newPassword: z.string().min(6, '密码至少 6 位').max(64, '密码最多 64 位'),
});

/** 角色绑定（A-02，至少一个角色） */
export const AdminUserRolesSchema = z.object({
  roles: z.array(ROLE_ENUM).min(1, '至少保留一个角色'),
});

/** 新增会员等级（A-03） */
export const AdminPlanCreateSchema = z.object({
  code: z.string().min(2, '编码至少 2 位').max(32, '编码最多 32 位'),
  level: z.enum(['PRO', 'ENTERPRISE']),
  cycle: z.enum(['SINGLE', 'MONTHLY', 'YEAR']),
  name: z.string().min(1, '等级名称不能为空').max(64, '名称最多 64 位'),
  tag: z.string().max(64, '标签最多 64 位').optional(),
  badge: z.string().max(32, '角标最多 32 位').optional(),
  priceCents: z.number().int('价格必须为整数（分）').min(0, '价格不能为负'),
  originPriceCents: z.number().int('原价必须为整数（分）').min(0, '原价不能为负').optional(),
  features: z.array(z.string()).optional(),
  sort: z.number().int().optional(),
});

/** 编辑会员等级（A-03，编码不可改） */
export const AdminPlanUpdateSchema = AdminPlanCreateSchema.omit({ code: true }).partial();

/** 会员等级上下架（A-03） */
export const AdminPlanEnabledSchema = z.object({
  enabled: z.boolean(),
});

/** 批量续费提醒（A-03） */
export const AdminBatchRenewalSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1, '请选择至少一个用户'),
});

/* ===== M6.3 数据资源 / 数据治理 / 运营管理 ===== */

/** 字典类型编码（A-06 五类共用） */
export const DICT_TYPE_ENUM = z.enum(['COUNTRY', 'ORG', 'INDUSTRY', 'UNIT', 'TIME']);

/** 新增指标（A-05） */
export const AdminIndicatorCreateSchema = z.object({
  code: z.string().min(2, '编码至少 2 位').max(64, '编码最多 64 位').regex(/^[A-Za-z0-9_.-]+$/, '编码仅限字母/数字/下划线/点/横线'),
  name: z.string().min(1, '指标名称不能为空').max(128, '名称最多 128 位'),
  category: z.string().min(1, '分类不能为空').max(64, '分类最多 64 位'),
  unit: z.string().min(1, '单位不能为空').max(32, '单位最多 32 位'),
  definition: z.string().max(512, '定义最多 512 位').optional(),
  enabled: z.boolean().optional(),
});

/** 编辑指标（A-05，code 可改但唯一） */
export const AdminIndicatorUpdateSchema = AdminIndicatorCreateSchema.partial();

/** 新增指标来源映射（A-05） */
export const AdminMappingCreateSchema = z.object({
  sourceName: z.string().min(1, '数据源名称不能为空').max(128, '数据源最多 128 位'),
  sourceField: z.string().min(1, '来源字段不能为空').max(128, '来源字段最多 128 位'),
  transform: z.string().max(128, '换算方式最多 128 位').optional(),
  enabled: z.boolean().optional(),
});

/** 编辑指标来源映射（A-05） */
export const AdminMappingUpdateSchema = AdminMappingCreateSchema.partial();

/** 新增字典项（A-06） */
export const AdminDictCreateSchema = z.object({
  type: DICT_TYPE_ENUM,
  code: z.string().min(1, '编码不能为空').max(64, '编码最多 64 位'),
  name: z.string().min(1, '名称不能为空').max(128, '名称最多 128 位'),
  nameEn: z.string().max(128, '英文名最多 128 位').optional(),
  parentCode: z.string().max(64, '上级编码最多 64 位').optional(),
  remark: z.string().max(255, '说明最多 255 位').optional(),
  sort: z.number().int().optional(),
  enabled: z.boolean().optional(),
});

/** 编辑字典项（A-06，type/code 不可改） */
export const AdminDictUpdateSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(128, '名称最多 128 位'),
  nameEn: z.string().max(128, '英文名最多 128 位').optional(),
  parentCode: z.string().max(64, '上级编码最多 64 位').optional(),
  remark: z.string().max(255, '说明最多 255 位').optional(),
  sort: z.number().int().optional(),
});

/** 字典项停用/启用（A-06） */
export const AdminDictEnabledSchema = z.object({
  enabled: z.boolean(),
});

/** 编辑数据集元数据（A-07） */
export const AdminDatasetUpdateSchema = z.object({
  name: z.string().min(1, '数据集名称不能为空').max(255, '名称最多 255 位'),
  category: z.string().max(64, '分类最多 64 位').optional(),
  meta: z.record(z.unknown()).optional(),
});

/** 数据集上下架（A-07） */
export const AdminDatasetStatusSchema = z.object({
  status: z.enum(['ONLINE', 'OFFLINE']),
});

/** 导入审核退回（A-08，原因必填） */
export const AdminImportRejectSchema = z.object({
  reason: z.string().min(1, '退回原因不能为空').max(512, '原因最多 512 位'),
});

/** 新增公告（A-09） */
export const AdminNoticeCreateSchema = z.object({
  title: z.string().min(1, '公告标题不能为空').max(255, '标题最多 255 位'),
  content: z.string().min(1, '公告内容不能为空').max(10000, '内容最多 10000 字'),
  scope: z.enum(['ALL', 'ROLE', 'ORG']).default('ALL'),
  scopeValue: z.string().max(64, '范围值最多 64 位').optional(),
});

/** 编辑公告（A-09） */
export const AdminNoticeUpdateSchema = AdminNoticeCreateSchema.partial();

/** 搜索词运营动作（A-10：设为快捷检索 / 加入搜索建议） */
export const AdminTermFlagsSchema = z.object({
  isQuick: z.boolean().optional(),
  isSuggest: z.boolean().optional(),
}).refine((v) => v.isQuick !== undefined || v.isSuggest !== undefined, {
  message: '至少指定一个运营动作',
});

/** 新增敏感词（A-10） */
export const AdminSensitiveCreateSchema = z.object({
  word: z.string().min(1, '敏感词不能为空').max(128, '敏感词最多 128 位'),
  type: z.enum(['POLITICS', 'ILLEGAL', 'OTHER']),
});

/** 编辑敏感词（A-10） */
export const AdminSensitiveUpdateSchema = AdminSensitiveCreateSchema.partial();

/** 敏感词启用/停用（A-10） */
export const AdminSensitiveEnabledSchema = z.object({
  enabled: z.boolean(),
});

/* ===== M6.4 任务中心 / 系统管理 ===== */

/** 更新系统参数（A-12，取值范围校验按 key 在服务层执行） */
export const AdminConfigUpdateSchema = z.object({
  value: z.string().min(1, '参数值不能为空').max(512, '参数值最多 512 位'),
});

/** 备份策略（A-15，存 sys_configs：backup.scope / backup.schedule / backup.keep） */
export const AdminBackupPolicySchema = z.object({
  /** 备份范围：full=全量 / data=仅业务数据 / config=仅配置 */
  scope: z.enum(['full', 'data', 'config']),
  /** 执行周期：daily / weekly / monthly */
  schedule: z.enum(['daily', 'weekly', 'monthly']),
  /** 保留份数 */
  keep: z.number().int('保留份数必须为整数').min(1, '至少保留 1 份').max(365, '最多保留 365 份'),
});

export type AdminConfigUpdate = z.infer<typeof AdminConfigUpdateSchema>;
export type AdminBackupPolicy = z.infer<typeof AdminBackupPolicySchema>;

export type AdminUserCreate = z.infer<typeof AdminUserCreateSchema>;
export type AdminUserUpdate = z.infer<typeof AdminUserUpdateSchema>;
export type AdminUserStatus = z.infer<typeof AdminUserStatusSchema>;
export type AdminResetPassword = z.infer<typeof AdminResetPasswordSchema>;
export type AdminUserRoles = z.infer<typeof AdminUserRolesSchema>;
export type AdminPlanCreate = z.infer<typeof AdminPlanCreateSchema>;
export type AdminPlanUpdate = z.infer<typeof AdminPlanUpdateSchema>;
export type AdminPlanEnabled = z.infer<typeof AdminPlanEnabledSchema>;
export type AdminBatchRenewal = z.infer<typeof AdminBatchRenewalSchema>;
export type AdminIndicatorCreate = z.infer<typeof AdminIndicatorCreateSchema>;
export type AdminIndicatorUpdate = z.infer<typeof AdminIndicatorUpdateSchema>;
export type AdminMappingCreate = z.infer<typeof AdminMappingCreateSchema>;
export type AdminMappingUpdate = z.infer<typeof AdminMappingUpdateSchema>;
export type AdminDictCreate = z.infer<typeof AdminDictCreateSchema>;
export type AdminDictUpdate = z.infer<typeof AdminDictUpdateSchema>;
export type AdminDictEnabled = z.infer<typeof AdminDictEnabledSchema>;
export type AdminDatasetUpdate = z.infer<typeof AdminDatasetUpdateSchema>;
export type AdminDatasetStatus = z.infer<typeof AdminDatasetStatusSchema>;
export type AdminImportReject = z.infer<typeof AdminImportRejectSchema>;
export type AdminNoticeCreate = z.infer<typeof AdminNoticeCreateSchema>;
export type AdminNoticeUpdate = z.infer<typeof AdminNoticeUpdateSchema>;
export type AdminTermFlags = z.infer<typeof AdminTermFlagsSchema>;
export type AdminSensitiveCreate = z.infer<typeof AdminSensitiveCreateSchema>;
export type AdminSensitiveUpdate = z.infer<typeof AdminSensitiveUpdateSchema>;
export type AdminSensitiveEnabled = z.infer<typeof AdminSensitiveEnabledSchema>;
