import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchController } from '../src/modules/search/search.controller';
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
  };
  const ctrl = new SearchController(search as any, intent as any, generate as any, store as any);
  return { ctrl, search, intent, generate, store };
}

describe('SearchController.stream', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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