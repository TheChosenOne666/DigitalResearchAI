import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import { Prisma, KbVisibility } from '../../generated/prisma/client';
import { parsePageParams, buildPageResult } from './pagination';

/**
 * 知识权限管理服务（A-18）：默认权限规则（sys_configs）+ 条目级公开/私有切换。
 * 条目列表跨租户走 PrismaService 本体（系统 client），操作有审计日志（controller 侧记录）。
 */
@Injectable()
export class KbPermAdminService {
  private readonly logger = new Logger(KbPermAdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 默认权限规则（sys_configs：kb.defaultVisibility / kb.privateScope） */
  async getPermissionRule() {
    const configs = await this.prisma.sysConfig.findMany({
      where: { key: { in: ['kb.defaultVisibility', 'kb.privateScope'] } },
    });
    return {
      defaultVisibility: configs.find((c) => c.key === 'kb.defaultVisibility')?.value ?? 'PRIVATE',
      privateScope: configs.find((c) => c.key === 'kb.privateScope')?.value ?? 'SUBMITTER',
    };
  }

  /** 保存默认权限规则（值域校验对齐 CONFIG_VALUE_RULES） */
  async updatePermissionRule(input: { defaultVisibility?: string; privateScope?: string }) {
    const updates: Array<{ key: string; value: string; label: string; remark: string }> = [];
    if (input.defaultVisibility !== undefined) {
      if (!['PRIVATE', 'PUBLIC', 'ORG'].includes(input.defaultVisibility)) {
        throw new BizException(ErrorCode.VALIDATION_FAILED, '默认权限取值不合法', HttpStatus.BAD_REQUEST);
      }
      updates.push({
        key: 'kb.defaultVisibility',
        value: input.defaultVisibility,
        label: '知识库默认可见性',
        remark: '新入库条目默认可见性（A-18）',
      });
    }
    if (input.privateScope !== undefined) {
      if (!['SUBMITTER', 'ORG', 'ADMIN'].includes(input.privateScope)) {
        throw new BizException(ErrorCode.VALIDATION_FAILED, '私有范围取值不合法', HttpStatus.BAD_REQUEST);
      }
      updates.push({
        key: 'kb.privateScope',
        value: input.privateScope,
        label: '私有条目可见范围',
        remark: '私有条目可见范围（A-18）',
      });
    }
    for (const u of updates) {
      await this.prisma.sysConfig.upsert({
        where: { key: u.key },
        create: { ...u, updatedBy: 'admin' },
        update: { value: u.value, updatedBy: 'admin' },
      });
    }
    this.logger.log(`管理端更新知识权限规则：${updates.map((u) => `${u.key}=${u.value}`).join(', ')}`);
    return this.getPermissionRule();
  }

  /** 条目权限列表（跨租户，已完成学习的条目） */
  async listPermissionItems(query: { keyword?: string; visibility?: string; page: number; pageSize: number }) {
    const where: Prisma.KbDocumentWhereInput = { status: 'READY' };
    if (query.visibility === 'PUBLIC' || query.visibility === 'PRIVATE') {
      where.visibility = query.visibility as KbVisibility;
    }
    const keyword = query.keyword?.trim();
    if (keyword) {
      where.name = { contains: keyword };
    }
    const params = parsePageParams(String(query.page), String(query.pageSize));
    const [total, docs] = await Promise.all([
      this.prisma.kbDocument.count({ where }),
      this.prisma.kbDocument.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: params.skip,
        take: params.take,
        select: { id: true, tenantId: true, libraryId: true, name: true, visibility: true, updatedAt: true },
      }),
    ]);
    const tenantNames = await this.loadTenantNames([...new Set(docs.map((d) => d.tenantId))]);
    const libraries = docs.length
      ? await this.prisma.kbLibrary.findMany({
          where: { id: { in: [...new Set(docs.map((d) => d.libraryId))] } },
          select: { id: true, name: true },
        })
      : [];
    const list = docs.map((d) => ({
      id: d.id,
      name: d.name,
      tenantName: tenantNames.get(d.tenantId) ?? null,
      libraryName: libraries.find((l) => l.id === d.libraryId)?.name ?? null,
      visibility: d.visibility,
      updatedAt: d.updatedAt,
    }));
    return buildPageResult(list, total, params);
  }

  /** 条目公开⇄私有切换（前端二次确认，后端审计） */
  async setItemVisibility(id: string, visibility: 'PUBLIC' | 'PRIVATE') {
    const doc = await this.prisma.kbDocument.findUnique({
      where: { id },
      select: { id: true, visibility: true, name: true },
    });
    if (!doc) {
      throw new BizException(ErrorCode.NOT_FOUND, '条目不存在', HttpStatus.NOT_FOUND);
    }
    if (doc.visibility === visibility) {
      throw new BizException(ErrorCode.VALIDATION_FAILED, '条目已是该可见性', HttpStatus.BAD_REQUEST);
    }
    const updated = await this.prisma.kbDocument.update({ where: { id }, data: { visibility } });
    this.logger.log(`管理端切换条目可见性：doc=${id} ${doc.visibility} -> ${visibility}`);
    return { id: updated.id, visibility: updated.visibility };
  }

  /** 批量加载租户名（跨租户归属展示） */
  private async loadTenantNames(tenantIds: string[]): Promise<Map<string, string>> {
    if (!tenantIds.length) return new Map();
    const rows = await this.prisma.tenant.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
