import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchController } from '../src/modules/search/search.controller';
import { BizException } from '../src/common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';
import type { AuthenticatedRequest } from '../src/common/auth/session-auth.guard';

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
  // M5.3 免费体验配额：默认放行
  const quota = { consumeTrial: vi.fn().mockResolvedValue({ allowed: true, trialLeft: null }) };
  const ctrl = new SearchController(
    search as any,
    intent as any,
    generate as any,
    store as any,
    kb as any,
    quota as any,
  );
  return { ctrl, search, intent, generate, store, kb, quota };
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
    await expect(ctrl.stream(req(), res as any, '问题')).rejects.toMatchObject({ bizCode: 4003 });
    // 拦截发生在响应头写出之前，前端可按统一业务码弹开通引导
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('敏感词命中（M6.3/D8）：不写 SSE 响应头，直接抛 FORBIDDEN', async () => {
    const { ctrl, store, quota } = deps();
    store.checkSensitiveWord.mockResolvedValueOnce('违禁词');
    const { res } = fakeRes();
    await expect(ctrl.stream(req(), res as any, '违禁词')).rejects.toMatchObject({ bizCode: 2001 });
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
    await ctrl.stream(req(), res as any, '问题');
    expect(quota.consumeTrial).toHaveBeenCalledWith('u1', ['USER']);
    expect(res.setHeader).toHaveBeenCalled();
  });

  it('五阶段编排：intent→检索→融合→生成→done，含落库', async () => {
    const { ctrl, search, intent, generate, store } = deps();
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
    await ctrl.stream(req(), f.res, '美国 GDP', 'hybrid', undefined);

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
    await ctrl.stream(req(), f.res, 'q', 'hybrid', undefined);

    expect(store.saveReport).not.toHaveBeenCalled();
    expect(store.upsertUsage).not.toHaveBeenCalled();
    expect(f.joined()).toContain('event: done');
  });

  it('检索失败时推送 error（含阶段）', async () => {
    const { ctrl, search, intent, store } = deps();
    intent.classify.mockResolvedValue({});
    search.search.mockRejectedValue(new Error('boom'));
    store.createSession.mockResolvedValue({ id: 's1' });

    const f = fakeRes();
    await ctrl.stream(req(), f.res, 'q', 'hybrid', undefined);

    expect(f.joined()).toContain('event: error');
    expect(f.joined()).toContain('"message":"boom"');
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
    const p = ctrl.stream(req(), f.res, 'q', 'hybrid', undefined);
    // 等待拦截（M5.3 配额校验）与 close 绑定完成，再模拟客户端断开
    await new Promise((resolve) => setImmediate(resolve));
    f.triggerClose();
    await p;
    expect(f.res.end).toHaveBeenCalled();
  });
});

describe('SearchController.histories / reportDetail', () => {
  it('histories 分页调 store', async () => {
    const { ctrl, store } = deps();
    store.listSessions.mockResolvedValue([{ id: 's1', question: 'q' }]);
    const r = await ctrl.histories(req(), '1', '10');
    expect(r.items).toHaveLength(1);
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
      { idx: 0, title: '来源A', url: 'https://a', snippet: '摘A', sourceType: 'web', isCited: true },
      { idx: 1, title: '来源B', url: null, snippet: '摘B', sourceType: 'vertical', isCited: false },
    ],
  };

  it('勾选来源逐条入库：映射字段并携带问题快照/可见性/标签', async () => {
    const { ctrl, store, kb } = deps();
    store.reportDetail.mockResolvedValue(reportDetailStub);
    kb.saveSourcesToLibrary.mockResolvedValue({ created: 1, documents: [{ id: 'kd1', name: '来源A.md' }] });

    const r = await ctrl.saveToKb('s1', {
      idxs: [0],
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
        sources: [{ idx: 0, title: '来源A', url: 'https://a', snippet: '摘A', sourceType: 'web' }],
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
    await expect(ctrl.saveToKb('s1', { idxs: [0] })).rejects.toThrow(/目标知识库/);
    // 报告不存在：store 层抛 404 业务异常
    store.reportDetail.mockRejectedValue(new BizException(ErrorCode.NOT_FOUND, '报告不存在', 404));
    await expect(ctrl.saveToKb('s1', { idxs: [0], libraryId: 'lib1' })).rejects.toThrow(/报告不存在/);
    store.reportDetail.mockResolvedValue(reportDetailStub);
    await expect(ctrl.saveToKb('s1', { idxs: [9], libraryId: 'lib1' })).rejects.toThrow(
      /所选来源不存在/,
    );
    expect(store.reportDetail).toHaveBeenCalledTimes(2);
    expect(kb.saveSourcesToLibrary).not.toHaveBeenCalled();
  });
});