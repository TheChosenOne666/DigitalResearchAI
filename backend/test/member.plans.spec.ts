import { describe, it, expect } from 'vitest';
import { groupPlansByLevel, MEMBER_PLAN_SEEDS, FREE_TRIAL_LIMIT } from '../src/modules/member/plans';

describe('MEMBER_PLAN_SEEDS（对齐原型定价）', () => {
  it('覆盖 2 个等级 × 3 个周期共 6 条', () => {
    expect(MEMBER_PLAN_SEEDS).toHaveLength(6);
    const codes = MEMBER_PLAN_SEEDS.map((p) => p.code);
    expect(new Set(codes).size).toBe(6);
    expect(codes).toEqual(
      expect.arrayContaining(['PRO_SINGLE', 'PRO_MONTHLY', 'PRO_YEAR', 'ENT_SINGLE', 'ENT_MONTHLY', 'ENT_YEAR']),
    );
  });

  it('专业版价格：单月 59 / 连续包月 49 / 年付 499（划线 708）', () => {
    const byCode = Object.fromEntries(MEMBER_PLAN_SEEDS.map((p) => [p.code, p]));
    expect(byCode.PRO_SINGLE.priceCents).toBe(5900);
    expect(byCode.PRO_MONTHLY.priceCents).toBe(4900);
    expect(byCode.PRO_YEAR.priceCents).toBe(49900);
    expect(byCode.PRO_YEAR.originPriceCents).toBe(70800);
  });

  it('企业版价格：单月 399 / 连续包月 329 / 年付 3999（划线 4788）', () => {
    const byCode = Object.fromEntries(MEMBER_PLAN_SEEDS.map((p) => [p.code, p]));
    expect(byCode.ENT_SINGLE.priceCents).toBe(39900);
    expect(byCode.ENT_MONTHLY.priceCents).toBe(32900);
    expect(byCode.ENT_YEAR.priceCents).toBe(399900);
    expect(byCode.ENT_YEAR.originPriceCents).toBe(478800);
  });

  it('免费体验次数为 1', () => {
    expect(FREE_TRIAL_LIMIT).toBe(1);
  });
});

describe('groupPlansByLevel', () => {
  const rows = MEMBER_PLAN_SEEDS.map((p, i) => ({
    id: `plan_${i}`,
    code: p.code,
    level: p.level,
    cycle: p.cycle,
    name: p.name,
    tag: p.tag,
    badge: p.badge,
    priceCents: p.priceCents,
    originPriceCents: p.originPriceCents,
    features: p.features as unknown,
    sort: p.sort,
  }));

  it('按等级分组，顺序固定为专业版 → 企业版', () => {
    const groups = groupPlansByLevel(rows);
    expect(groups.map((g) => g.level)).toEqual(['PRO', 'ENTERPRISE']);
    expect(groups[0].levelName).toBe('专业版');
    expect(groups[1].levelName).toBe('企业版');
  });

  it('组内按 sort 升序：单月 → 连续包月 → 年付', () => {
    const groups = groupPlansByLevel(rows);
    expect(groups[0].plans.map((p) => p.cycle)).toEqual(['SINGLE', 'MONTHLY', 'YEAR']);
    expect(groups[0].plans.map((p) => p.cycleName)).toEqual(['单月', '连续包月', '年付']);
  });

  it('金额同时给出分与元，年付折算月单价', () => {
    const groups = groupPlansByLevel(rows);
    const year = groups[0].plans.find((p) => p.cycle === 'YEAR');
    expect(year?.amount).toBe(499);
    expect(year?.originAmount).toBe(708);
    expect(year?.monthAmount).toBe(41.58); // 49900/12/100
    const single = groups[0].plans.find((p) => p.cycle === 'SINGLE');
    expect(single?.monthAmount).toBeNull();
    expect(single?.originAmount).toBeNull();
  });

  it('空列表不产生分组', () => {
    expect(groupPlansByLevel([])).toEqual([]);
  });

  it('features 非数组时降级为空数组', () => {
    const groups = groupPlansByLevel([{ ...rows[0], features: null }]);
    expect(groups[0].plans[0].features).toEqual([]);
  });
});
