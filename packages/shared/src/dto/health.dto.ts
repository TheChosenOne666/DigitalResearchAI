import { z } from 'zod';

/** 健康检查查询参数：verbose=true 时返回各依赖服务状态 */
export const HealthQuerySchema = z.object({
  verbose: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

export type HealthQuery = z.infer<typeof HealthQuerySchema>;

/** 健康检查响应数据 */
export interface HealthData {
  status: 'ok' | 'degraded';
  uptime: number;
  version: string;
  checks?: {
    postgres: 'up' | 'down';
    redis: 'up' | 'down';
    qdrant: 'up' | 'down';
  };
}
