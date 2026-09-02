import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { getTenantContext } from '../../common/auth/tenant-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';

/** 整数范围校验规则（返回错误信息或 null） */
function intRange(min: number, max: number): (v: string) => string | null {
  return (v) => {
    if (!/^-?\d+$/.test(v)) return '参数值必须为整数';
    const n = Number(v);
    if (n < min || n > max) return `参数值需在 ${min} ~ ${max} 之间`;
    return null;
  };
}

/** 数值范围校验规则（支持小数） */
function floatRange(min: number, max: number): (v: string) => string | null {
  return (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '参数值必须为数字';
    if (n < min || n > max) return `参数值需在 ${min} ~ ${max} 之间`;
    return null;
  };
}

/** 枚举校验规则 */
function enumRule(values: string[]): (v: string) => string | null {
  return (v) => (values.includes(v) ? null : `参数值仅限：${values.join(' / ')}`);
}

/** 参数取值范围校验规则表（A-12：防止非法值导致系统异常，未登记的 key 兜底长度校验） */
export const CONFIG_VALUE_RULES: Record<string, (v: string) => string | null> = {
  'upload.maxSizeMb': intRange(1, 1024),
  'task.timeoutMinutes': intRange(1, 1440),
  'list.pageSize': intRange(1, 100),
  'kb.matchThreshold': floatRange(0, 1),
  'backup.scope': enumRule(['full', 'data', 'config']),
  'backup.schedule': enumRule(['daily', 'weekly', 'monthly']),
  'backup.keep': intRange(1, 365),
  'kb.defaultVisibility': enumRule(['PRIVATE', 'PUBLIC', 'ORG']),
  'kb.privateScope': enumRule(['SUBMITTER', 'ORG', 'ADMIN']),
  'rate.authRate': floatRange(0.01, 1000),
  'rate.authBurst': intRange(1, 100000),
  'rate.globalRate': floatRange(0.01, 100000),
  'rate.globalBurst': intRange(1, 1000000),
  'rate.sseMaxConcurrent': intRange(1, 1000),
};

/**
 * 校验参数值是否在取值范围内（纯函数，供单测）。
 * @param key 参数键
 * @param value 参数值
 * @returns 错误信息；合法返回 null
 */
export function validateConfigValue(key: string, value: string): string | null {
  const rule = CONFIG_VALUE_RULES[key];
  if (!rule) {
    return value.length > 512 ? '参数值最多 512 位' : null;
  }
  return rule(value);
}

/**
 * 系统管理 · 参数配置服务（A-12）。
 * 平台级运行参数读写（sys_configs），修改即时生效（读取侧每次查库），全部操作落审计。
 */
@Injectable()
export class AdminConfigsService {
  private readonly logger = new Logger(AdminConfigsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 参数列表（按 key 排序） */
  async list() {
    const rows = await this.prisma.sysConfig.findMany({ orderBy: { key: 'asc' } });
    return rows;
  }

  /** 更新参数值（范围校验失败拒绝保存，记录最近修改人） */
  async update(key: string, value: string) {
    const existing = await this.prisma.sysConfig.findUnique({ where: { key } });
    if (!existing) {
      throw new BizException(ErrorCode.NOT_FOUND, '参数不存在', HttpStatus.NOT_FOUND);
    }
    const invalid = validateConfigValue(key, value);
    if (invalid) {
      throw new BizException(ErrorCode.VALIDATION_FAILED, invalid, HttpStatus.BAD_REQUEST);
    }
    const operatorId = getTenantContext()?.userId ?? null;
    const row = await this.prisma.sysConfig.update({
      where: { key },
      data: { value, updatedBy: operatorId },
    });
    this.logger.log(`管理端更新系统参数: key=${key} value=${value}`);
    return row;
  }
}
