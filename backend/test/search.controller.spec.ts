import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchController } from '../src/modules/search/search.controller';
import { BizException } from '../src/common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import type { AuthenticatedRequest } from '../src/common/auth/session-auth.guard';
import { MetricsService } from '../src/common/observability/metrics.service';

/** 假 Response：收集 SSE 帧 */
function fakeRes() {
  const frames: string[] = [];
  let closeCb: (() => void) | null = null;
  const res: any = {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((s: string) => frames.push(s)),
    end: vi.fn(),
    on: vi.fn((ev: string, cb: () => void) => {
      if (ev === 'close') closeCb = cb;
    }),
  };
  return { res, frames, triggerClose: () => closeCb?.(), joined: () => frames.join('') };
}

const req = (): AuthenticatedRequest =>
  ({ user: { userId: 'u1', tenantId: 't1', roles: ['USER'], createdAt: 0 }, headers: {}, query: {} }) as any;

const hit = (title: string, sourceType: 'web' | 'vertical' | 'local', url?: string) => ({
  title,
  snippet: 's',
  url,
  contentMd: 'md',
  sourceType,
});

function deps() {
  const search = { search: vi.fn() };
  const intent = { classify: vi.fn() };
  const generate = { stream: vi.fn() };
  const store = {
    createSession: vi.fn(),
    saveReport: vi.fn(),
    upsertUsage: vi.fn(),
    listSessions: vi.fn(),
    reportDetail: vi.fn(),
    // M6.3：敏感词前置拦截（默认不命中）+ 搜索词统计
    checkSensitiveWord: vi.fn().mockResolvedValue(null),
    trackSearchTerm: vi.fn().mockResolvedValue(undefined),
  };
  const kb = { saveSourcesToLibrary: vi.fn() };
  // M5.3 免费体验配额：默认放行（rollbackTrial 供失败回滚断言）
  const quota = {
    consumeTrial: vi.fn().mockResolvedValue({ allowed: true, trialLeft: null }),
    rollbackTrial: vi.fn().mockResolvedValue(undefined),
  };
  // M7.1：SSE 连接数/断连率指标。直接实例化但不触发 onModuleInit，避免测试连接 Redis
  const metrics = new MetricsService({ get: (_k: string, d?: string) => d } as any);
  // M7.2：SSE 并发槽位，测试默认放行并记录调用
  const rateLimit = {
    acquireSseSlot: vi.fn().mockResolvedValue(undefined),
    releaseSseSlot: vi.fn().mockResolvedValue(undefined),
  };
  // 检索优化 B：默认缓存未命中（走真实检索路径）
  const cache = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  };
  // 检索优化 C：默认精排回退（返回 null = 沿用 RRF 原序）
  const rerank = { rerank: vi.fn().mockResolvedValue(null) };
  // SSE 心跳配置（默认 15s；单测内不会推进到心跳周期）
  const config = { get: (_k: string, d?: number) => d };
  const ctrl = new SearchController(
    search as any,
    intent as any,
    generate as any,
    store as any,
    cache as any,
    rerank as any,
    kb as any,
    quota as any,
    metrics as any,
    rateLimit as any,
    config as any,
  );
  return { ctrl, search, intent, generate, store, cache, rerank, kb, quota, metrics, rateLimit };
}

describe('SearchController.stream', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('免费体验配额耗尽（M5.3）：不写 SSE 响应头，直接抛 4003', async () => {
    const { ctrl, quota } = deps();
    quota.consumeTrial.mockRejectedValueOnce(
      new BizException(ErrorCode.QUOTA_EXCEEDED, '免费体验次数已用完，开通会员可无限次使用', 402),
    );
    const { res } = fakeRes();
    await expect(ctrl.stream(req(), res as any, { question: '问题' })).rejects.toMatchObject({ bizCode: 4003 });
    // 拦截发生在响应头写出之前，前端可按统一业务码弹开通引导
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('敏感词命中（M6.3/D8）：不写 SSE 响应头，直接抛 FORBIDDEN', async () => {
    const { ctrl, store, quota } = deps();
    store.checkSensitiveWord.mockResolvedValueOnce('违禁词');
    const { res } = fakeRes();
    await expect(ctrl.stream(req(), res as any, { question: '违禁词' })).rejects.toMatchObject({ bizCode: 2001 });
    expect(res.setHeader).not.toHaveBeenCalled();
    // 敏感词拦截在配额校验之前，命中后不消耗配额
    expect(quota.consumeTrial).not.toHaveBeenCalled();
  });

  it('配额放行后才进入智搜管道', async () => {
    const { ctrl, quota, intent, search, generate, store } = deps();
    intent.classify.mockResolvedValue({});
    search.search.mockResolvedValue({ cited: [], referenced: [] });
    generate.stream.mockResolvedValue({ fullText: '', tokenUsage: 0 });
    store.createSession.mockResolvedValue({ id: 's1' });
    const { res } = fakeRes();
    await ctrl.stream(req(), res as any, { question: '问题' });
    expect(quota.consumeTrial).toHaveBeenCalledWith('u1', ['USER']);
    expect(res.setHeader).toHaveBeenCalled();
  });

  it('五阶段编排：intent→检索→融合→生成→done，含落库', async () => {
    const { ctrl, search, intent, generate, store, quota } = deps();
    intent.classify.mockResolvedValue({ indicators: ['GDP'] });
    search.search.mockResolvedValue({
      cited: [hit('A', 'vertical')],
      referenced: [hit('B', 'web', 'https://b')],
    });
    generate.stream.mockImplementation(async (_req: unknown, _sig: unknown, onChunk: (c: any) => void) => {
      onChunk({ text: '报告', citations: [1] });
      return { fullText: '报告', tokenUsage: 8, citations: [1] };
    });
    store.createSession.mockResolvedValue({ id: 's1' });
    store.saveReport.mockResolvedValue({ id: 'r1' });
    store.upsertUsage.mockResolvedValue(undefined);

    const f = fakeRes();
    await ctrl.stream(req(), f.res, { question: '美国 GDP', mode: 'hybrid' });

    const out = f.joined();
    expect(out).toContain('event: stage');
    expect(out).toContain('"stage":"generating"');
    // 来源卡（引用+参考）
    expect(out).toContain('event: source');
    expect(out).toContain('"isCited":true');
    expect(out).toContain('"isCited":false');
    // 流式正文
    expect(out).toContain('event: report_chunk');
    expect(out).toContain('"citations":[1]');
    // 完成事件带真实 id
    expect(out).toContain('event: done');
    expect(out).toContain('"sessionId":"s1"');
    expect(out).toContain('"reportId":"r1"');
    // 落库
    expect(store.saveReport).toHaveBeenCalledWith('s1', expect.objectContaining({ contentMd: '报告', tokenUsage: 8 }));
    expect(store.upsertUsage).toHaveBeenCalledWith('u1', 8);
    // 管道成功不回滚试额
    expect(quota.rollbackTrial).not.toHaveBeenCalled();
    // M6.3 搜索词统计：有结果（cited+referenced>0）→ empty=false
    expect(store.trackSearchTerm).toHaveBeenCalledWith('美国 GDP', false);
    expect(f.res.end).toHaveBeenCalled();
  });

  it('生成空文本时跳过落库但仍发 done', async () => {
    const { ctrl, search, intent, generate, store } = deps();
    intent.classify.mockResolvedValue({});
    search.search.mockResolvedValue({ cited: [], referenced: [] });
    generate.stream.mockResolvedValue({ fullText: '', tokenUsage: 0, citations: [] });
    store.createSession.mockResolvedValue({ id: 's1' });

    const f = fakeRes();
    await ctrl.stream(req(), f.res, { question: 'q', mode: 'hybrid' });

    expect(store.saveReport).not.toHaveBeenCalled();
    expect(store.upsertUsage).not.toHaveBeenCalled();
    expect(f.joined()).toContain('event: done');
  });

  it('检索优化 B 缓存命中：跳过真实检索，来源卡照常推送且不回写缓存', async () => {
    const { ctrl, search, intent, generate, store, cache } = deps();
    intent.classify.mockResolvedValue({});
    const cached = {
      cited: [hit('缓存命中A', 'local', 'kb://lib/d/0')],
      referenced: [],
      ranked: [],
    };
    cache.get.mockResolvedValue(cached);
    generate.stream.mockImplementation(async (_r: unknown, _s: unknown, onChunk: (c: any) => void) => {
      onChunk({ text: '缓存报告', citations: [] });
      return { fullText: '缓存报告', tokenUsage: 1, citations: [] };
    });
    store.createSession.mockResolvedValue({ id: 's1' });
    store.saveReport.mockResolvedValue({ id: 'r1' });

    const f = fakeRes();
    await ctrl.stream(req(), f.res, { question: '重复问题', mode: 'hybrid' });

    expect(search.search).not.toHaveBeenCalled(); // 未真实检索
    expect(cache.set).not.toHaveBeenCalled(); // 命中不回写
    expect(f.joined()).toContain('"title":"缓存命中A"'); // 来源卡照常
    expect(f.joined()).toContain('event: done');
  });

  it('检索优化 B 缓存未命中：真实检索后回写（fire-and-forget）', async () => {
    const { ctrl, search, intent, generate, store, cache } = deps();
    intent.classify.mockResolvedValue({});
    const fresh = { cited: [hit('新结果', 'web', 'https://x')], referenced: [], ranked: [] };
    search.search.mockResolvedValue(fresh);
    generate.stream.mockResolvedValue({ fullText: 'r', tokenUsage: 0, citations: [] });
    store.createSession.mockResolvedValue({ id: 's1' });
    store.saveReport.mockResolvedValue({ id: 'r1' });

    const f = fakeRes();
    await ctrl.stream(req(), f.res, { question: '新问题', mode: 'hybrid' });

    expect(search.search).toHaveBeenCalledTimes(1);
    // 单测无租户 ALS 上下文，缓存键回退 userId 维度
    expect(cache.set).toHaveBeenCalledWith('u1', 'hybrid', '新问题', expect.any(Object), fresh);
  });

  it('检索优化 C 精排生效：候选整体重排后按原引用级门槛重新切分，并随缓存保存', async () => {
    const { ctrl, search, intent, generate, store, cache, rerank } = deps();
    intent.classify.mockResolvedValue({});
    const a = hit('原引用1', 'web', 'https://a');
    const b = hit('原引用2', 'web', 'https://b');
    const c = hit('原参考1', 'web', 'https://c');
    search.search.mockResolvedValue({ cited: [a, b], referenced: [c], ranked: [] });
    // 精排把参考级 c 提到最前
    rerank.rerank.mockResolvedValue([c, a, b]);
    generate.stream.mockResolvedValue({ fullText: 'r', tokenUsage: 0, citations: [] });
    store.createSession.mockResolvedValue({ id: 's1' });
    store.saveReport.mockResolvedValue({ id: 'r1' });

    const f = fakeRes();
    await ctrl.stream(req(), f.res, { question: 'q', mode: 'hybrid' });

    const out = f.joined();
    // 来源卡顺序 = 精排后顺序，首条（原参考级）现成为引用级
    const firstIdx = out.indexOf('"title":"原参考1"');
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(out.indexOf('"isCited":true', firstIdx)).toBeGreaterThan(0);
    // 精排后的顺序随缓存保存
    expect(cache.set).toHaveBeenCalledWith('u1', 'hybrid', 'q', expect.any(Object), {
      cited: [c, a],
      referenced: [b],
      ranked: [],
    });
  });

  it('检索优化 C 精排失败：回退 RRF 原序不阻断管道', async () => {
    const { ctrl, search, intent, generate, store, rerank } = deps();
    intent.classify.mockResolvedValue({});
    const a = hit('A', 'web', 'https://a');
    const b = hit('B', 'web', 'https://b');
    search.search.mockResolvedValue({ cited: [a, b], referenced: [], ranked: [] });
    // 服务契约：内部捕获一切失败并返回 null（回退原序），不会 reject
    rerank.rerank.mockResolvedValue(null);
    generate.stream.mockResolvedValue({ fullText: 'r', tokenUsage: 0, citations: [] });
    store.createSession.mockResolvedValue({ id: 's1' });
    store.saveReport.mockResolvedValue({ id: 'r1' });

    const f = fakeRes();
    await ctrl.stream(req(), f.res, { question: 'q', mode: 'hybrid' });
    // 原序推送且正常完成
    expect(f.joined()).toContain('event: done');
    expect(f.joined()).toContain('"title":"A"');
  });

  it('检索失败时推送 error（含阶段）并回滚本次试额', async () => {
    const { ctrl, search, intent, store, quota } = deps();
    intent.classify.mockResolvedValue({});
    search.search.mockRejectedValue(new Error('boom'));
    store.createSession.mockResolvedValue({ id: 's1' });

    const f = fakeRes();
    await ctrl.stream(req(), f.res, { question: 'q', mode: 'hybrid' });

    expect(f.joined()).toContain('event: error');
    expect(f.joined()).toContain('"message":"boom"');
    // M8 管道失败 → 免费试额回滚，避免「搜一次失败扣一次」
    expect(quota.rollbackTrial).toHaveBeenCalledWith('u1', ['USER']);
    expect(f.res.end).toHaveBeenCalled();
  });

  it('客户端断开触发 AbortController 联动（close 事件已绑定）', async () => {
    const { ctrl, search, intent, generate, store } = deps();
    intent.classify.mockResolvedValue({});
    // search 阻塞，直到外部 abort（含信号已先 abort 的情况）
    search.search.mockImplementation(
      (_input: unknown, signal: AbortSignal) =>
        new Promise((resolve) => {
          if (signal.aborted) return resolve({ cited: [], referenced: [] });
          signal.addEventListener('abort', () => resolve({ cited: [], referenced: [] }));
        }),
    );
    generate.stream.mockResolvedValue({ fullText: '', tokenUsage: 0, citations: [] });
    store.createSession.mockResolvedValue({ id: 's1' });

    const f = fakeRes();
    const p = ctrl.stream(req(), f.res, { question: 'q', mode: 'hybrid' });
    // 等待拦截（M5.3 配额校验）与 close 绑定完成，再模拟客户端断开
    await new Promise((resolve) => setImmediate(resolve));
    f.triggerClose();
    await p;
    expect(f.res.end).toHaveBeenCalled();
  });
});

describe('SearchController.histories / reportDetail', () => {
  it('histories 分页调 store 并透传真实总数', async () => {
    const { ctrl, store } = deps();
    store.listSessions.mockResolvedValue({ items: [{ id: 's1', question: 'q' }], total: 37 });
    const r = await ctrl.histories(req(), '1', '10');
    expect(r.items).toHaveLength(1);
    expect(r.total).toBe(37);
    expect(store.listSessions).toHaveBeenCalledWith('u1', 1, 10);
  });

  it('reportDetail 委托 store', async () => {
    const { ctrl, store } = deps();
    store.reportDetail.mockResolvedValue({ id: 'r1' });
    const r = await ctrl.reportDetail(req(), 'sid');
    expect(r).toEqual({ id: 'r1' });
    expect(store.reportDetail).toHaveBeenCalledWith('sid');
  });
});

describe('SearchController.saveToKb（M3.4 入库链路）', () => {
  const reportDetailStub = {
    id: 'r1',
    contentMd: '# 报告',
    paramsSnapshot: { question: '美国 GDP', mode: 'hybrid', conditions: {} },
    tokenUsage: 8,
    createdAt: new Date(),
    sources: [
      { idx: 1, title: '来源A', url: 'https://a', snippet: '摘A', sourceType: 'web', isCited: true },
      { idx: 2, title: '来源B', url: null, snippet: '摘B', sourceType: 'vertical', isCited: false },
    ],
  };

  it('勾选来源逐条入库：映射字段并携带问题快照/可见性/标签', async () => {
    const { ctrl, store, kb } = deps();
    store.reportDetail.mockResolvedValue(reportDetailStub);
    kb.saveSourcesToLibrary.mockResolvedValue({ created: 1, documents: [{ id: 'kd1', name: '来源A.md' }] });

    const r = await ctrl.saveToKb('s1', {
      idxs: [1],
      libraryId: 'lib1',
      groupId: null,
      visibility: 'PUBLIC',
      tags: ['宏观', 'GDP'],
    });

    expect(kb.saveSourcesToLibrary).toHaveBeenCalledWith(
      expect.objectContaining({
        libraryId: 'lib1',
        groupId: null,
        visibility: 'PUBLIC',
        tags: ['宏观', 'GDP'],
        sessionId: 's1',
        question: '美国 GDP',
        sources: [{ idx: 1, title: '来源A', url: 'https://a', snippet: '摘A', sourceType: 'web' }],
      }),
    );
    expect(r).toEqual({ created: 1, documents: [{ id: 'kd1', name: '来源A.md' }] });
  });

  it('未勾选来源抛校验异常，不触库查询', async () => {
    const { ctrl, store, kb } = deps();
    await expect(ctrl.saveToKb('s1', { idxs: [], libraryId: 'lib1' })).rejects.toThrow(/请先勾选/);
    await expect(ctrl.saveToKb('s1', { idxs: ['x'], libraryId: 'lib1' })).rejects.toThrow(/请先勾选/);
    expect(store.reportDetail).not.toHaveBeenCalled();
    expect(kb.saveSourcesToLibrary).not.toHaveBeenCalled();
  });

  it('缺目标库 / 报告不存在 / 来源序号不匹配分别报错', async () => {
    const { ctrl, store, kb } = deps();
    await expect(ctrl.saveToKb('s1', { idxs: [1] })).rejects.toThrow(/目标知识库/);
    // 报告不存在：store 层抛 404 业务异常
    store.reportDetail.mockRejectedValue(new BizException(ErrorCode.NOT_FOUND, '报告不存在', 404));
    await expect(ctrl.saveToKb('s1', { idxs: [1], libraryId: 'lib1' })).rejects.toThrow(/报告不存在/);
    store.reportDetail.mockResolvedValue(reportDetailStub);
    await expect(ctrl.saveToKb('s1', { idxs: [99], libraryId: 'lib1' })).rejects.toThrow(
      /所选来源不存在/,
    );
    expect(store.reportDetail).toHaveBeenCalledTimes(2);
    expect(kb.saveSourcesToLibrary).not.toHaveBeenCalled();
  });
});