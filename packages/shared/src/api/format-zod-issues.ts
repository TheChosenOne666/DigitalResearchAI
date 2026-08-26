import type { ZodIssue } from 'zod';

/**
 * 将 Zod 校验错误 issues 格式化为可读字符串，如 "verbose: 必填"。
 */
export function formatZodIssues(issues: ZodIssue[]): string {
  return issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}
