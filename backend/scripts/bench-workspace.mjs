#!/usr/bin/env node
/**
 * M7.2 工作台查询接口并发压测（零依赖，Node 22 原生 fetch）。
 *
 * 目标接口默认 /workspace/datasets（普通读接口，命中 checkGlobal 令牌桶限流）。
 * 统计：成功率、状态码分布、延迟 P50/P95/P99、吞吐（req/s）。
 *
 * 用法：
 *   node scripts/bench-workspace.mjs \
 *     --concurrency 20 --requests 200 --path /api/v1/workspace/datasets \
 *     --base http://localhost:3000 \
 *     --phone 13800000000 --password admin123
 */
import { parseArgs } from 'node:util';

const args = parseArgs({
  options: {
    concurrency: { type: 'string', default: '20' },
    requests: { type: 'string', default: '200' },
    path: { type: 'string', default: '/api/v1/workspace/datasets' },
    base: { type: 'string', default: process.env.BENCH_BASE ?? 'http://localhost:3000' },
    timeout: { type: 'string', default: '30000' },
    phone: { type: 'string', default: process.env.BENCH_PHONE ?? '13800000000' },
    password: { type: 'string', default: process.env.BENCH_PASSWORD ?? 'admin123' },
    help: { type: 'boolean', default: false },
  },
}).values;

if (args.help) {
  console.log('工作台接口压测：node scripts/bench-workspace.mjs --concurrency 20 --requests 200');
  process.exit(0);
}

const BASE = args.base.replace(/\/$/, '');
const CONCURRENCY = Math.max(1, Number(args.concurrency));
const REQUESTS = Math.max(1, Number(args.requests));
const PATH = args.path.startsWith('/') ? args.path : `/${args.path}`;
const TIMEOUT_MS = Number(args.timeout);
const PHONE = args.phone;
const PASSWORD = args.password;

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(1) : '-');

async function login() {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: PHONE, password: PASSWORD }),
  });
  const body = await res.json();
  if (body.code !== 0 || !body.data?.sessionId) {
    throw new Error(`登录失败: ${JSON.stringify(body)}`);
  }
  return body.data.sessionId;
}

async function runPool(sessionId) {
  const latencies = [];
  const statuses = {};
  let ok = 0;
  let cursor = 0;

  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= REQUESTS) return;
      const started = Date.now();
      let status = 0;
      let err = null;
      try {
        const res = await fetch(`${BASE}${PATH}`, {
          headers: { Authorization: `Bearer ${sessionId}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        status = res.status;
        await res.arrayBuffer(); // 消费 body，确保计时覆盖完整响应
      } catch (e) {
        err = e.name === 'TimeoutError' ? 'timeout' : `${e.name}`;
        status = 0;
      }
      const ms = Date.now() - started;
      if (err == null && status < 400) ok += 1;
      latencies.push(ms);
      statuses[`${status}${err ? `(${err})` : ''}`] = (statuses[`${status}${err ? `(${err})` : ''}`] ?? 0) + 1;
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, REQUESTS) }, () => worker());
  await Promise.all(workers);
  return { latencies, statuses, ok };
}

async function main() {
  console.log(`工作台压测：并发=${CONCURRENCY} 请求数=${REQUESTS} path=${PATH}`);
  const sessionId = await login();
  const t0 = Date.now();
  const { latencies, statuses, ok } = await runPool(sessionId);
  const wall = Date.now() - t0;
  const sorted = [...latencies].sort((a, b) => a - b);

  console.log('\n=== 工作台压测结果 ===');
  console.log(`请求数      : ${latencies.length}`);
  console.log(`成功(2xx)   : ${ok} (${((ok / latencies.length) * 100).toFixed(1)}%)`);
  console.log(`吞吐        : ${((latencies.length / wall) * 1000).toFixed(1)} req/s`);
  console.log(`延迟     ms : P50=${fmt(pct(sorted, 50))} P95=${fmt(pct(sorted, 95))} P99=${fmt(pct(sorted, 99))} max=${sorted[sorted.length - 1] ?? '-'}`);
  console.log('状态码分布  :');
  for (const [k, v] of Object.entries(statuses)) console.log(`  - ${k}: ${v}`);
  if (statuses['429'] || statuses['429(undefined)']) {
    console.log('  ↳ 出现 429 表示触发限流（rate.globalRate/rate.globalBurst 阈值生效）');
  }

  process.exit(ok === latencies.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
