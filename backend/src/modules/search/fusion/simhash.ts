/**
 * SimHash 去重（64 位，bigint 存储）。纯函数，便于单测。
 * 用于融合后剔除内容高度重复的命中（保留得分高者）。
 */

const BITS = 64;
const MASK64 = (1n << 64n) - 1n;

/** FNV-1a 64 位字符串哈希（取模保证非负） */
function hash64(s: string): bigint {
  let h = 14695981039346656037n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 1099511628211n) & MASK64;
  }
  return h;
}

/** 简易分词：中文按字、英文/数字按连续段 */
function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens: string[] = [];
  const re = /[a-z0-9]+|[\u4e00-\u9fa5]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lower)) !== null) tokens.push(m[0]);
  return tokens;
}

/** 计算 64 位 SimHash 指纹 */
export function simHash(text: string, bits = BITS): bigint {
  const tokens = tokenize(text);
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);

  const v = new Array<number>(bits).fill(0);
  for (const [tok, w] of counts) {
    const h = hash64(tok);
    for (let i = 0; i < bits; i++) {
      const bit = (h >> BigInt(i)) & 1n;
      v[i] += bit ? w : -w;
    }
  }
  let fingerprint = 0n;
  for (let i = 0; i < bits; i++) {
    if (v[i] > 0) fingerprint |= 1n << BigInt(i);
  }
  return fingerprint;
}

/** 汉明距离（两指纹不同位数） */
export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let d = 0;
  while (x > 0n) {
    d += Number(x & 1n);
    x >>= 1n;
  }
  return d;
}

/**
 * 按 SimHash 去重，保留得分高者。
 * 汉明距离 ≤ threshold（默认 3）视为重复。
 */
export function dedupeBySimHash<T>(
  items: { item: T; text: string; score: number }[],
  threshold = 3,
): T[] {
  const kept: { item: T; hash: bigint; score: number }[] = [];
  for (const it of items) {
    const hash = simHash(it.text);
    const dup = kept.find((k) => hammingDistance(k.hash, hash) <= threshold);
    if (dup) {
      if (it.score > dup.score) {
        dup.item = it.item;
        dup.hash = hash;
        dup.score = it.score;
      }
    } else {
      kept.push({ item: it.item, hash, score: it.score });
    }
  }
  return kept.map((k) => k.item);
}
