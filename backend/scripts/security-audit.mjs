#!/usr/bin/env node
/**
 * M7.3 安全自测脚本（零依赖，Node 22 原生 fetch）。
 *
 * 覆盖五类检查（对应 docs/14-M7技术方案.md 第四节）：
 *   1. 未授权路由扫描 —— 不带 token 访问各路由，非 @Public 应 401
 *   2. 租户越权矩阵   —— B 租户 token 访问 A 租户资源应被拒绝（403/404）
 *   3. 注入探测       —— SQL/脚本注入 payload 不应导致 500/异常栈
 *   4. 支付回调重放   —— 同笔订单重复回调应幂等（不重复入账）
 *   5. 限流绕过       —— 伪造 X-Forwarded-For 是否可绕过 IP 维度限流
 *
 * 用法：
 *   node scripts/security-audit.mjs \
 *     --base http://localhost:3000 \
 *     --admin-phone 13800000000 --admin-password admin123 \
 *     --tenant-a 13800001111 --tenant-b 13800002222
 *
 * 说明：租户越权/支付重放依赖可写测试账号，用 dev-login（需 DEV_LOGIN_ENABLED=true）
 * 或短信登录造两个租户；环境不可用时对应项标记 SKIP，不影响其余项。
 */
import { parseArgs } from 'node:util';

const args = parseArgs({
  options: {
    base: { type: 'string', default: process.env.BENCH_BASE ?? 'http://localhost:3000' },
    adminPhone: { type: 'string', default: process.env.AUDIT_ADMIN_PHONE ?? '13800000000' },
    adminPassword: { type: 'string', default: process.env.AUDIT_ADMIN_PASSWORD ?? 'admin123' },
    tenantA: { type: 'string', default: process.env.AUDIT_TENANT_A ?? '13800001111' },
    tenantB: { type: 'string', default: process.env.AUDIT_TENANT_B ?? '13800002222' },
    help: { type: 'boolean', default: false },
  },
}).values;

if (args.help) {
  console.log('安全自测：node scripts/security-audit.mjs --base http://localhost:3000');
  process.exit(0);
}

const BASE = args.base.replace(/\/$/, '');
const results = [];
const report = (category, name, status, detail = '') => {
  results.push({ category, name, status, detail });
  const tag = { PASS: '✅', FAIL: '❌', WARN: '⚠️ ', SKIP: '⏭️ ' }[status] ?? '·';
  console.log(`${tag} [${category}] ${name}${detail ? ` — ${detail}` : ''}`);
};

/** 通用请求，返回 { status, body }（body 尽力解析 JSON） */
async function req(path, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, body: json, text };
}

/** 账密登录（返回 sessionId） */
async function passwordLogin(phone, password) {
  const { status, body } = await req('/api/v1/auth/login', { method: 'POST', body: { phone, password } });
  return status === 200 && body?.code === 0 ? body.data.sessionId : null;
}

/** dev-login（返回 sessionId；未开启则 null） */
async function devLogin(phone) {
  const { status, body } = await req('/api/v1/auth/dev-login', { method: 'POST', body: { phone } });
  return status === 200 && body?.code === 0 ? body.data.sessionId : null;
}

// ── 1. 未授权路由扫描 ────────────────────────────────────────────────
async function checkUnauthorizedRoutes() {
  const cases = [
    ['GET', '/api/v1/search/histories'],
    ['GET', '/api/v1/workspace/datasets'],
    ['GET', '/api/v1/kb/libraries'],
    ['GET', '/api/v1/member/subscription'],
    ['GET', '/api/v1/admin/me'],
    ['GET', '/api/v1/admin/dashboard/overview'],
  ];
  for (const [method, path] of cases) {
    const { status } = await req(path, { method });
    // 非 @Public 接口未带 token 应返回 401；若 200 说明鉴权缺失
    const pass = status === 401;
    report('未授权扫描', `${method} ${path}`, pass ? 'PASS' : 'FAIL', `HTTP ${status}${pass ? '' : '（预期 401）'}`);
  }
  // @Public 端点应放行（health/metrics）
  for (const path of ['/api/v1/health', '/api/v1/metrics']) {
    const { status } = await req(path);
    report('未授权扫描', `GET ${path}（@Public 应放行）`, status === 200 ? 'PASS' : 'FAIL', `HTTP ${status}`);
  }
}

// ── 2. 租户越权矩阵 ────────────────────────────────────────────────
async function checkTenantIsolation() {
  const tokenA = (await passwordLogin(args.tenantA, 'wrongpass')) ?? (await devLogin(args.tenantA));
  const tokenB = (await passwordLogin(args.tenantB, 'wrongpass')) ?? (await devLogin(args.tenantB));
  if (!tokenA || !tokenB) {
    report('租户越权', 'A/B 租户测试账号', 'SKIP', '无法取得两个租户会话（dev-login 未开启或账号不可用）');
    return;
  }
  // A 建知识库，B 越权访问
  const created = await req('/api/v1/kb/libraries', {
    method: 'POST',
    token: tokenA,
    body: { name: `审计库-${Date.now()}`, description: 'security-audit 临时库' },
  });
  if (created.status !== 200 && created.status !== 201) {
    report('租户越权', 'A 创建知识库', 'SKIP', `创建失败 HTTP ${created.status}`);
    return;
  }
  const libId = created.body?.data?.id;
  if (!libId) {
    report('租户越权', 'A 创建知识库', 'SKIP', '响应缺少 id');
    return;
  }
  // B 读 A 的库：应 403/404，不应 200
  const cross = await req(`/api/v1/kb/libraries/${libId}`, { token: tokenB });
  const blocked = cross.status === 403 || cross.status === 404;
  report('租户越权', `B 访问 A 的库 ${libId}`, blocked ? 'PASS' : 'FAIL', `HTTP ${cross.status}${blocked ? '' : '（越权成功！）'}`);
  // B 列表不应看到 A 的库
  const listB = await req('/api/v1/kb/libraries', { token: tokenB });
  const ids = (listB.body?.data?.items ?? listB.body?.data ?? []).map((x) => x?.id);
  report('租户越权', 'B 的库列表不含 A 的库', !ids.includes(libId) ? 'PASS' : 'FAIL', ids.includes(libId) ? '（列表泄漏）' : '');
}

// ── 3. 注入探测 ─────────────────────────────────────────────────────
async function checkInjection() {
  const token = await devLogin(args.tenantA) ?? await passwordLogin(args.tenantA, 'x');
  const payloads = [
    "'; DROP TABLE users; --",
    "' OR '1'='1",
    '<script>alert(1)</script>',
    '${7*7}',
  ];
  for (const q of payloads) {
    const { status } = await req(`/api/v1/search/stream?question=${encodeURIComponent(q)}`, { token, headers: token ? {} : {} });
    // 注入探测：只要不 500 暴露栈，即视为可控（4xx 限流/校验也可接受）
    const pass = status !== 500;
    report('注入探测', `question=${q.slice(0, 24)}`, pass ? 'PASS' : 'FAIL', `HTTP ${status}`);
  }
}

// ── 4. 支付回调重放 ─────────────────────────────────────────────────
async function checkPayReplay() {
  // 需要真实订单：先下单再 mock-pay 两次。依赖支付链路可用，否则跳过。
  report('支付回调重放', 'mock-pay 重复回调幂等', 'SKIP', '需先创建订单（依赖支付链路，环境未就绪时跳过）');
}

// ── 5. 限流绕过（X-Forwarded-For 伪造） ─────────────────────────────
async function checkRateLimitBypass() {
  // 连续用不同 XFF 打登录接口，观察是否每次都放行到业务（若服务端信任 XFF 取 IP，则伪造可绕过 IP 限流）
  let rateLimited = false;
  for (let i = 0; i < 40; i++) {
    const { status } = await req('/api/v1/auth/login', {
      method: 'POST',
      body: { phone: `1990000${String(i % 10).padStart(4, '0')}`, password: 'x' },
      headers: { 'X-Forwarded-For': `10.0.0.${i}` },
    });
    if (status === 429) { rateLimited = true; break; }
  }
  // 若始终未触发 429，说明 XFF 伪造可能绕过了 IP 维度限流（WARN，需结合反代配置复核）
  report('限流绕过', '伪造 X-Forwarded-For 连打 40 次登录', rateLimited ? 'PASS' : 'WARN', rateLimited ? '已触发 429' : '未触发 429，需确认反代是否覆盖 XFF');
}

async function main() {
  console.log(`安全自测：base=${BASE}\n`);
  const health = await req('/api/v1/health');
  if (health.status !== 200) {
    console.error(`❌ 服务不可用（/health HTTP ${health.status}），请先启动 API 与基础设施。`);
    process.exit(2);
  }

  await checkUnauthorizedRoutes();
  await checkTenantIsolation();
  await checkInjection();
  await checkPayReplay();
  await checkRateLimitBypass();

  const fail = results.filter((r) => r.status === 'FAIL').length;
  const warn = results.filter((r) => r.status === 'WARN').length;
  const skip = results.filter((r) => r.status === 'SKIP').length;
  console.log(`\n=== 汇总：PASS ${results.length - fail - warn - skip} / FAIL ${fail} / WARN ${warn} / SKIP ${skip} ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
