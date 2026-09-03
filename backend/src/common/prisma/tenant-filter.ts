/**
 * 租户行级隔离：Prisma Client Extension 查询注入（纯函数，便于单测）。
 * 对带 tenantId 的业务模型，在 ORM 层强制注入 tenant_id——应用代码无法漏带（ADR-2）。
 */

/** 带租户隔离的业务模型（新增业务表时在此登记） */
export const TENANT_MODELS = new Set<string>([
  'User',
  'AuditLog',
  'SearchSession',
  'SearchReport',
  'SearchSource',
  'SearchUsage',
  'KbLibrary',
  'KbGroup',
  'KbDocument',
  'KbChunk',
  'WorkspaceReport',
  'WorkspaceDataset',
  'MemberSubscription',
  'MemberOrder',
  'PaymentRecord',
  'TrialQuota',
  // 注意：MemberPlan 为平台级公共数据（全租户共享），不登记租户隔离
]);

/** 需要注入 where.tenantId 的查询操作（含 extended where unique 的 update/delete） */
const WHERE_OPS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'updateOne',
  'updateMany',
  'delete',
  'deleteOne',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
  'upsert',
]);

/** 需要注入 data.tenantId 的创建操作 */
const CREATE_OPS = new Set(['create', 'createOne']);

/** 需要注入数组每项 data.tenantId 的批量创建操作 */
const CREATE_MANY_OPS = new Set(['createMany', 'createManyAndReturn']);

/** 判定操作是否需要租户注入（模型在隔离清单 + 操作类型已知） */
export function needsTenantFilter(model: string | undefined, operation: string): boolean {
  if (!model || !TENANT_MODELS.has(model)) return false;
  return (
    WHERE_OPS.has(operation) ||
    CREATE_OPS.has(operation) ||
    CREATE_MANY_OPS.has(operation)
  );
}

/**
 * 向操作参数注入 tenantId（返回新对象，不改原参）：
 * - 查询/更新/删除：where.tenantId
 * - create：data.tenantId
 * - createMany：data 数组每项
 * - upsert：where/create/update 三处
 */
export function applyTenantFilter<T extends Record<string, unknown>>(
  args: T,
  operation: string,
  tenantId: string,
): T {
  const next: Record<string, unknown> = { ...args };

  // where 缺省时也必须注入：findMany 无 where 会退化为全表查询，造成跨租户泄漏
  if (WHERE_OPS.has(operation)) {
    next.where = { ...((next.where as Record<string, unknown>) ?? {}), tenantId };
  }

  if (CREATE_OPS.has(operation)) {
    next.data = { ...(next.data as Record<string, unknown>), tenantId };
  }

  if (CREATE_MANY_OPS.has(operation)) {
    const data = next.data;
    if (Array.isArray(data)) {
      next.data = data.map((item) => ({ ...item, tenantId }));
    }
  }

  if (operation === 'upsert') {
    if (next.where !== undefined) {
      next.where = { ...(next.where as Record<string, unknown>), tenantId };
    }
    if (next.create !== undefined) {
      next.create = { ...(next.create as Record<string, unknown>), tenantId };
    }
    if (next.update !== undefined) {
      next.update = { ...(next.update as Record<string, unknown>), tenantId };
    }
  }

  return next as T;
}
