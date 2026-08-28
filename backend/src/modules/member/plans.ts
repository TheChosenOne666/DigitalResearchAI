import type { MemberLevel, PlanCycle } from '../../generated/prisma/client';

/** 套餐种子项（对齐原型 index.html 会员中心 VIP.PLANS / VIP.CYCLES） */
export interface MemberPlanSeed {
  /** 套餐编码（唯一） */
  code: string;
  /** 会员等级 */
  level: MemberLevel;
  /** 购买周期 */
  cycle: PlanCycle;
  /** 展示名 */
  name: string;
  /** 卖点标签 */
  tag: string;
  /** 售价（分） */
  priceCents: number;
  /** 划线原价（分，仅年付） */
  originPriceCents: number | null;
  /** 周期角标 */
  badge: string;
  /** 权益列表 */
  features: string[];
  /** 同等级内排序 */
  sort: number;
}

/** 周期展示名映射 */
export const CYCLE_NAMES: Record<PlanCycle, string> = {
  SINGLE: '单月',
  MONTHLY: '连续包月',
  YEAR: '年付',
};

/** 等级展示名映射 */
export const LEVEL_NAMES: Record<MemberLevel, string> = {
  FREE: '免费用户',
  PRO: '专业版',
  ENTERPRISE: '企业版',
};

/**
 * 平台内置套餐（M5 seed）：专业版 / 企业版 × 单月 / 连续包月 / 年付。
 * 价格对齐原型会员中心定价；M6 管理端（A-03）直接改库维护。
 */
export const MEMBER_PLAN_SEEDS: MemberPlanSeed[] = [
  {
    code: 'PRO_SINGLE',
    level: 'PRO',
    cycle: 'SINGLE',
    name: '专业版 · 单月',
    tag: '个人研究首选',
    priceCents: 5900,
    originPriceCents: null,
    badge: '',
    features: [
      'AI 智搜无限次，无体验上限',
      '数据分析工作台全功能',
      'Word / CSV / PNG 成果导出',
      '知识库全文检索 · 更大容量',
      '多源并行检索 · 深度推理',
    ],
    sort: 1,
  },
  {
    code: 'PRO_MONTHLY',
    level: 'PRO',
    cycle: 'MONTHLY',
    name: '专业版 · 连续包月',
    tag: '个人研究首选',
    priceCents: 4900,
    originPriceCents: null,
    badge: '灵活',
    features: [
      'AI 智搜无限次，无体验上限',
      '数据分析工作台全功能',
      'Word / CSV / PNG 成果导出',
      '知识库全文检索 · 更大容量',
      '多源并行检索 · 深度推理',
    ],
    sort: 2,
  },
  {
    code: 'PRO_YEAR',
    level: 'PRO',
    cycle: 'YEAR',
    name: '专业版 · 年付',
    tag: '个人研究首选',
    priceCents: 49900,
    originPriceCents: 70800,
    badge: '最推荐',
    features: [
      'AI 智搜无限次，无体验上限',
      '数据分析工作台全功能',
      'Word / CSV / PNG 成果导出',
      '知识库全文检索 · 更大容量',
      '多源并行检索 · 深度推理',
    ],
    sort: 3,
  },
  {
    code: 'ENT_SINGLE',
    level: 'ENTERPRISE',
    cycle: 'SINGLE',
    name: '企业版 · 单月',
    tag: '企业级容量',
    priceCents: 39900,
    originPriceCents: null,
    badge: '',
    features: [
      '含专业版全部权益',
      '企业知识库 500GB 私有检索',
      '多端共享数据看板',
      '检索任务并行调度优先',
      '专属客户成功经理',
    ],
    sort: 1,
  },
  {
    code: 'ENT_MONTHLY',
    level: 'ENTERPRISE',
    cycle: 'MONTHLY',
    name: '企业版 · 连续包月',
    tag: '企业级容量',
    priceCents: 32900,
    originPriceCents: null,
    badge: '灵活',
    features: [
      '含专业版全部权益',
      '企业知识库 500GB 私有检索',
      '多端共享数据看板',
      '检索任务并行调度优先',
      '专属客户成功经理',
    ],
    sort: 2,
  },
  {
    code: 'ENT_YEAR',
    level: 'ENTERPRISE',
    cycle: 'YEAR',
    name: '企业版 · 年付',
    tag: '企业级容量',
    priceCents: 399900,
    originPriceCents: 478800,
    badge: '最推荐',
    features: [
      '含专业版全部权益',
      '企业知识库 500GB 私有检索',
      '多端共享数据看板',
      '检索任务并行调度优先',
      '专属客户成功经理',
    ],
    sort: 3,
  },
];

/** 非会员免费体验次数（对齐原型 VIP.TRIAL） */
export const FREE_TRIAL_LIMIT = 1;

/**
 * 按等级分组套餐（纯函数）：等级 → { level, levelName, tag, plans[] }。
 * 组内按 sort 升序（单月 → 连续包月 → 年付）。
 */
export function groupPlansByLevel(
  plans: Array<{
    id: string;
    code: string;
    level: MemberLevel;
    cycle: PlanCycle;
    name: string;
    tag: string | null;
    badge: string | null;
    priceCents: number;
    originPriceCents: number | null;
    features: unknown;
    sort: number;
  }>,
): Array<{
  level: MemberLevel;
  levelName: string;
  tag: string | null;
  plans: Array<{
    id: string;
    code: string;
    cycle: PlanCycle;
    cycleName: string;
    name: string;
    badge: string | null;
    priceCents: number;
    amount: number;
    originPriceCents: number | null;
    originAmount: number | null;
    monthAmount: number | null;
    features: string[];
  }>;
}> {
  const order: MemberLevel[] = ['PRO', 'ENTERPRISE'];
  return order
    .map((level) => {
      const list = plans
        .filter((p) => p.level === level)
        .sort((a, b) => a.sort - b.sort)
        .map((p) => ({
          id: p.id,
          code: p.code,
          cycle: p.cycle,
          cycleName: CYCLE_NAMES[p.cycle],
          name: p.name,
          badge: p.badge,
          priceCents: p.priceCents,
          amount: p.priceCents / 100,
          originPriceCents: p.originPriceCents,
          originAmount: p.originPriceCents === null ? null : p.originPriceCents / 100,
          // 年付折算月单价（仅年付展示，如 499 → 约 42 元/月）
          monthAmount: p.cycle === 'YEAR' ? Math.round(p.priceCents / 12) / 100 : null,
          features: Array.isArray(p.features) ? (p.features as string[]) : [],
        }));
      const first = plans.find((p) => p.level === level);
      if (!first) return null;
      return {
        level,
        levelName: LEVEL_NAMES[level],
        tag: first.tag,
        plans: list,
      };
    })
    .filter((g): g is NonNullable<typeof g> => g !== null);
}
