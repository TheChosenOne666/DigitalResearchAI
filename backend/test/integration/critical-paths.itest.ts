import Redis from 'ioredis';
import request from 'supertest';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { VerticalWorldBankConnector } from '../../src/modules/search/connectors/vertical.connector';
import { LocalConnector } from '../../src/modules/search/connectors/local.connector';
import { WebAnySearchConnector } from '../../src/modules/search/connectors/web.connector';
import { INTEGRATION_DB_URL, INTEGRATION_REDIS_URL } from './setup/env';
import { ensureDatabase, runMigrateDeploy, runSeedAdmin } from './setup/db';

/**
 * 关键链路集成测试（进程内起真实 app + supertest 直打 HTTP）：
 * 1. 认证：密码登录 → 会话访问 → 无 token 401 → 登出后 401
 * 2. 配额：dev-login 新用户 → 智搜扣 1 次免费额度（报告真实落库）→ 第二次 4003
 * 3. 支付落账：下单 → mock-pay → 订阅到期推进 + 成功流水 → 重放被拒 → 会员检索不计次
 *
 * 外部依赖一律不真调：三路检索 connector 以 stub 覆盖（垂直路走 WDI 外网 API、
 * 联网路 AnySearch、本地路 Qdrant）；LLM 未配置 Key 走生产同款降级链路。
 * 运行：pnpm --filter @app/api test:integration
 */

/** 垂直路 stub 固定命中（含 contentMd，供融合→引用→报告链路使用） */
const VERTICAL_HITS = [
  {
    title: 'WDI · GDP 年增长率（中国）',
    url: 'https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG',
    snippet: '中国 GDP 年增长率 2020-2021 年度值',
    contentMd: '| 年份 | 中国 |\n| --- | --- |\n| 2020 | 2.3 |\n| 2021 | 8.6 |',
    sourceType: 'vertical' as const,
    rawScore: 1,
  },
];

let app: INestApplication;
let prisma: PrismaService;
let redis: Redis;

const server = () => app.getHttpServer();

/** 测试手机号生成（138 + 毫秒 7 位 + 序号 1 位）：每次运行全新用户，天然免清表 */
let phoneSeq = 0;
function nextPhone(): string {
  phoneSeq += 1;
  return `138${String(((Date.now() % 10_000_000) * 10 + (phoneSeq % 10)) % 100_000_000).padStart(8, '0')}`;
}

/** dev-login 新用户（会话 + 用户信息） */
async function devLogin(): Promise<{ sessionId: string; user: { id: string } }> {
  const res = await request(server()).post('/api/v1/auth/dev-login').send({ phone: nextPhone() }).expect(200);
  return res.body.data;
}

/** SSE 帧解析（event + data JSON） */
function parseSseFrames(text: string): Array<{ event: string; data: Record<string, unknown> | null }> {
  return text
    .split('\n\n')
    .filter((block) => block.trim())
    .map((block) => {
      let event = 'stage';
      const dataLines: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      }
      let data: Record<string, unknown> | null = null;
      try {
        data = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
      } catch {
        /* 心跳/空帧无 data */
      }
      return { event, data };
    });
}

/** 发起一次智搜 SSE（带显式条件，垂直路 stub 恒有命中） */
function streamSearch(token: string, question: string) {
  return request(server())
    .get('/api/v1/search/stream')
    .query({
      question,
      mode: 'hybrid',
      conditions: JSON.stringify({ countries: ['中国'], indicators: ['GDP增长率'], yearFrom: 2020, yearTo: 2025 }),
    })
    .set('Authorization', `Bearer ${token}`);
}

beforeAll(async () => {
  const dbUrl = await ensureDatabase(INTEGRATION_DB_URL);
  runMigrateDeploy(dbUrl);
  runSeedAdmin(dbUrl);

  redis = new Redis(INTEGRATION_REDIS_URL, { maxRetriesPerRequest: 2 });
  await redis.flushdb();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(VerticalWorldBankConnector)
    .useValue({ sourceType: 'vertical', search: async () => VERTICAL_HITS })
    .overrideProvider(LocalConnector)
    .useValue({ sourceType: 'local', search: async () => [] })
    .overrideProvider(WebAnySearchConnector)
    .useValue({ sourceType: 'web', search: async () => [] })
    .compile();

  app = moduleRef.createNestApplication();
  // 与 main.ts 保持一致的全局前缀（supertest 直打 HTTP，不走 listen）
  app.setGlobalPrefix('api/v1');
  await app.init();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app?.close();
  await redis?.quit().catch(() => redis?.disconnect());
});

describe('链路一：认证（密码登录 → 会话访问 → 无 token 401 → 登出后 401）', () => {
  it('完整认证链路', async () => {
    // seed-admin 内置管理员：13800000000 / admin123
    const login = await request(server())
      .post('/api/v1/auth/login')
      .send({ phone: '13800000000', password: 'admin123' })
      .expect(200);
    expect(login.body.code).toBe(0);
    const { sessionId, user } = login.body.data;
    expect(sessionId).toBeTruthy();
    expect(user.roles).toContain('PLATFORM_ADMIN');

    // 会话访问受保护端点
    await request(server())
      .get('/api/v1/member/subscription')
      .set('Authorization', `Bearer ${sessionId}`)
      .expect(200);

    // 无 token → 401
    await request(server()).get('/api/v1/member/subscription').expect(401);

    // 登出后原 token → 401（Redis 会话已销毁）
    await request(server())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${sessionId}`)
      .expect(200);
    await request(server())
      .get('/api/v1/member/subscription')
      .set('Authorization', `Bearer ${sessionId}`)
      .expect(401);
  });
});

describe('链路二：配额（新用户 → 智搜扣 1 次免费额度 → 第二次 4003）', () => {
  it('首次放行并真实落库，第二次 402/4003', async () => {
    const { sessionId, user } = await devLogin();
    const trialKey = `trial:used:${user.id}`;
    expect(await redis.get(trialKey)).toBeNull();

    // 第一次：SSE 全管道跑通（stage → source → report_chunk → done），报告真实落库
    const res = await streamSearch(sessionId, '中国 GDP 走势如何').expect(200);
    expect(String(res.headers['content-type'])).toContain('text/event-stream');
    const frames = parseSseFrames(res.text);
    const done = frames.find((f) => f.event === 'done');
    expect(done?.data?.sessionId).toBeTruthy();
    expect(done?.data?.reportId).toBeTruthy();
    const report = await prisma.searchReport.findUnique({
      where: { id: done!.data!.reportId as string },
    });
    expect(report?.contentMd.length).toBeGreaterThan(0);

    // 免费额度计数 = 1（Redis 原子 INCR）
    expect(await redis.get(trialKey)).toBe('1');

    // 第二次：402 + 业务码 4003（前端据此弹开通会员引导）
    const second = await streamSearch(sessionId, '再检索一次').expect(402);
    expect(second.body.code).toBe(4003);
    // 计数被回滚，不随重试越推越高
    expect(await redis.get(trialKey)).toBe('1');
  });
});

describe('链路三：支付落账（下单 → mock-pay → 订阅生效+流水 → 重放被拒 → 会员不计次）', () => {
  it('完整支付落账链路', async () => {
    const { sessionId, user } = await devLogin();

    // 套餐列表（ensureSeedPlans 幂等播种）
    const plansRes = await request(server())
      .get('/api/v1/member/plans')
      .set('Authorization', `Bearer ${sessionId}`)
      .expect(200);
    const plans = (
      plansRes.body.data.levels as Array<{ plans: Array<{ id: string; cycle: string }> }>
    ).flatMap((l) => l.plans);
    const monthly = plans.find((p) => p.cycle === 'MONTHLY');
    expect(monthly).toBeTruthy();

    // 下单（渠道缺省 MOCK）→ 待支付
    const orderRes = await request(server())
      .post('/api/v1/member/orders')
      .set('Authorization', `Bearer ${sessionId}`)
      .send({ planId: monthly!.id })
      .expect(201);
    const { orderNo, status } = orderRes.body.data;
    expect(orderNo).toBeTruthy();
    expect(status).toBe('PENDING');

    // mock-pay：与真实渠道回调走同一 handleNotify 路径
    const payRes = await request(server())
      .post(`/api/v1/member/orders/${orderNo}/mock-pay`)
      .set('Authorization', `Bearer ${sessionId}`)
      .expect(200);
    expect(payRes.body.data.ok).toBe(true);

    // 订阅生效：非 FREE，MONTHLY → 约 1 个月后到期
    const sub = (
      await request(server())
        .get('/api/v1/member/subscription')
        .set('Authorization', `Bearer ${sessionId}`)
        .expect(200)
    ).body.data;
    expect(sub.isMember).toBe(true);
    expect(sub.level).not.toBe('FREE');
    const daysLeft = (new Date(sub.expireAt).getTime() - Date.now()) / 86_400_000;
    expect(daysLeft).toBeGreaterThan(25);
    expect(daysLeft).toBeLessThan(40);

    // 成功流水恰好 1 条
    const order = await prisma.memberOrder.findFirstOrThrow({ where: { orderNo } });
    expect(order.status).toBe('PAID');
    const successFlows = await prisma.paymentRecord.findMany({
      where: { orderId: order.id, status: 'SUCCESS' },
    });
    expect(successFlows).toHaveLength(1);

    // 重放被拒：非 PENDING → 409，不产生新流水
    await request(server())
      .post(`/api/v1/member/orders/${orderNo}/mock-pay`)
      .set('Authorization', `Bearer ${sessionId}`)
      .expect(409);
    expect(
      await prisma.paymentRecord.findMany({ where: { orderId: order.id, status: 'SUCCESS' } }),
    ).toHaveLength(1);

    // 会员检索放行且不消耗免费额度
    const res = await streamSearch(sessionId, '会员身份检索一次').expect(200);
    expect(parseSseFrames(res.text).some((f) => f.event === 'done')).toBe(true);
    expect(await redis.get(`trial:used:${user.id}`)).toBeNull();
  });
});
