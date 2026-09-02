#!/usr/bin/env node
/**
 * M7.2 SSE 搜索链路压测（零依赖，Node 22 原生 fetch + ReadableStream）。
 *
 * 流程：登录拿 sessionId → 并发 N 路 /search/stream → 逐事件计时 → 汇总。
 * 统计口径：
 *   - 成功率   = 收到 done 事件的比例
 *   - 断连率   = 连接在 done 前异常关闭/超时/收到 error 的比例
 *   - 首包延迟 = 建连到第一个 SSE 事件到达的耗时（P50/P95/P99）
 *   - 总耗时   = 建连到 done/断开的耗时（P50/P95/P99）
 *
 * 用法：
 *   node scripts/bench-sse.mjs \
 *     --concurrency 10 --count 30 --question "美国2023年GDP" \
 *     --base http://localhost:3000 --timeout 60000 \
 *     --phone 13800000000 --password admin123
 *
 * 环境变量兜底：BENCH_BASE / BENCH_PHONE / BENCH_PASSWORD
 */
import { parseArgs } from 'node:util';

const args = parseArgs({
  options: {
    concurrency: { type: 'string', default: '10' },
    count: { type: 'string', default: '30' },
    question: { type: 'string', default: '美国2023年GDP' },
    base: { type: 'string', default: process.env.BENCH_BASE ?? 'http://localhost:3000' },
    timeout: { type: 'string', default: '60000' },
    phone: { type: 'string', default: process.env.BENCH_PHONE ?? '13800000000' },
    password: { type: 'string', default: process.env.BENCH_PASSWORD ?? 'admin123' },
    help: { type: 'boolean', default: false },
  },
}).values;

if (args.help) {
  console.log('SSE 搜索链路压测：node scripts/bench-sse.mjs --concurrency 10 --count 30');
  process.exit(0);
}

const BASE = args.base.replace(/\/$/, '');
const CONCURRENCY = Math.max(1, Number(args.concurrency));
const COUNT = Math.max(1, Number(args.count));
const QUESTION = args.question;
const TIMEOUT_MS = Number(args.timeout);
const PHONE = args.phone;
const PASSWORD = args.password;

/** 百分位 */
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

/** 跑一路 SSE，返回统计样本 */
async function runOne(sessionId, timeoutMs) {
  const started = Date.now();
  let firstPacketMs = null;
  let doneMs = null;
  let error = null;
  let sawDone = false;
  const stages = [];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(
      `${BASE}/api/v1/search/stream?question=${encodeURIComponent(QUESTION)}`,
      { headers: { Authorization: `Bearer ${sessionId}` }, signal: ctrl.signal },
    );
    if (!res.ok || !res.body) {
      error = `HTTP ${res.status}`;
      return { firstPacketMs, doneMs, error, sawDone, stages };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // 按 SSE 帧（空行分隔）切分；一个 chunk 可能含多帧
      const frames = buf.split('\n\n');
      buf = frames.pop() ?? '';
      for (const frame of frames) {
        if (firstPacketMs == null) firstPacketMs = Date.now() - started;
        const ev = frame.match(/^event:\s*(.+)$/m)?.[1]?.trim();
        if (ev === 'stage') {
          const st = frame.match(/"stage":"([^"]+)"/)?.[1];
          if (st) stages.push(st);
        }
        if (ev === 'done') {
          sawDone = true;
          doneMs = Date.now() - started;
        }
        if (ev === 'error') error = 'SSE error 事件';
      }
    }
  } catch (e) {
    error = ctrl.signal.aborted ? `超时(>${timeoutMs}ms)` : `${e.name}: ${e.message}`;
  } finally {
    clearTimeout(timer);
  }

  if (doneMs == null && sawDone === false && error == null) error = '连接在 done 前关闭';
  return { firstPacketMs, doneMs, error, sawDone, stages };
}

/** 并发调度：并发 CONCURRENCY，共 COUNT 个任务 */
async function runPool(sessionId) {
  const results = new Array(COUNT);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= COUNT) return;
      results[i] = await runOne(sessionId, TIMEOUT_MS);
    }
  }
  const workers = Array.from({ length: Math.min(CONCURRENCY, COUNT) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log(`SSE 压测：并发=${CONCURRENCY} 总数=${COUNT} question="${QUESTION}" timeout=${TIMEOUT_MS}ms`);
  const sessionId = await login();
  const t0 = Date.now();
  const results = await runPool(sessionId);
  const wall = Date.now() - t0;

  const ok = results.filter((r) => r.sawDone && !r.error);
  const dropped = results.filter((r) => r.error || !r.sawDone);
  const firsts = results.filter((r) => r.firstPacketMs != null).map((r) => r.firstPacketMs).sort((a, b) => a - b);
  const totals = results.map((r) => r.doneMs ?? r.firstPacketMs ?? 0).sort((a, b) => a - b);
  const fullStages = results.filter((r) => r.stages.length === 5).length;

  console.log('\n=== SSE 压测结果 ===');
  console.log(`完成流数    : ${results.length}`);
  console.log(`成功(done)  : ${ok.length} (${((ok.length / results.length) * 100).toFixed(1)}%)`);
  console.log(`断连/失败   : ${dropped.length} (${((dropped.length / results.length) * 100).toFixed(1)}%)`);
  console.log(`完整五阶段  : ${fullStages} (${((fullStages / results.length) * 100).toFixed(1)}%)`);
  console.log(`首包延迟 ms : P50=${fmt(pct(firsts, 50))} P95=${fmt(pct(firsts, 95))} P99=${fmt(pct(firsts, 99))}`);
  console.log(`总耗时   ms : P50=${fmt(pct(totals, 50))} P95=${fmt(pct(totals, 95))} P99=${fmt(pct(totals, 99))}`);
  console.log(`墙钟时间    : ${wall}ms (并发 ${CONCURRENCY})`);

  if (dropped.length > 0) {
    const byErr = {};
    for (const r of dropped) byErr[r.error ?? 'unknown'] = (byErr[r.error ?? 'unknown'] ?? 0) + 1;
    console.log('失败分布    :');
    for (const [k, v] of Object.entries(byErr)) console.log(`  - ${k}: ${v}`);
  }

  process.exit(dropped.length > 0 && ok.length === 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
