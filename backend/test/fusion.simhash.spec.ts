import { describe, it, expect } from 'vitest';
import { simHash, hammingDistance, dedupeBySimHash } from '../src/modules/search/fusion/simhash';

describe('simHash', () => {
  it('相同文本指纹一致，明显不同文本指纹不同', () => {
    expect(simHash('中国 GDP 增长')).toBe(simHash('中国 GDP 增长'));
    expect(simHash('中国 GDP 增长')).not.toBe(simHash('美国 人口 总数'));
  });
});

describe('hammingDistance', () => {
  it('相同为 0，差 1 位为 1，差 2 位为 2', () => {
    expect(hammingDistance(0n, 0n)).toBe(0);
    expect(hammingDistance(1n, 0n)).toBe(1);
    expect(hammingDistance(3n, 0n)).toBe(2);
  });
});

describe('dedupeBySimHash', () => {
  it('完全相同文本仅保留一份，且保留高分者', () => {
    const out = dedupeBySimHash([
      { item: 1, text: '重复文本段落', score: 1 },
      { item: 2, text: '重复文本段落', score: 9 },
    ]);
    expect(out).toEqual([2]);
  });

  it('完全相同文本合并为一条，保留高分者', () => {
    const out = dedupeBySimHash([
      { item: 1, text: '重复文本段落', score: 1 },
      { item: 2, text: '重复文本段落', score: 9 },
    ]);
    expect(out).toEqual([2]);
  });

  it('明显不同的文本各自保留，顺序保持输入序', () => {
    const out = dedupeBySimHash(
      [
        { item: 'A', text: '苹果 手机 销量 数据', score: 1 },
        { item: 'B', text: '香蕉 水果 热带 作物', score: 5 },
      ],
      3,
    );
    expect(out).toEqual(['A', 'B']);
  });

  it('阈值放大后即便明显不同也视为重复（验证阈值参数生效）', () => {
    const out = dedupeBySimHash(
      [
        { item: 'A', text: '苹果 手机 销量 数据', score: 1 },
        { item: 'B', text: '香蕉 水果 热带 作物', score: 5 },
      ],
      1000,
    );
    expect(out).toEqual(['B']); // 合并，保留高分
  });
});
