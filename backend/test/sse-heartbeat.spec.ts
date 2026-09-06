import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { startSseHeartbeat, SSE_HEARTBEAT_DEFAULT_MS } from '../src/common/sse/sse-heartbeat.util';

/** 构造最小 Response mock：记录 write 调用，可注入错误监听（EventEmitter 模拟 res 事件） */
function mockRes(opts: { throwOnWrite?: boolean } = {}) {
  const emitter = new EventEmitter();
  const writes: string[] = [];
  const res = {
    write: vi.fn((chunk: string) => {
      if (opts.throwOnWrite) throw new Error('write after end');
      writes.push(chunk);
      return true;
    }),
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
    __writes: writes,
  } as unknown as Response & { __writes: string[] };
  return res;
}

describe('startSseHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('默认间隔为 15s（低于常见网关 60s 空闲超时）', () => {
    expect(SSE_HEARTBEAT_DEFAULT_MS).toBe(15_000);
  });

  it('按间隔写入 SSE 注释帧（标准客户端自动忽略）', () => {
    const res = mockRes();
    const ac = new AbortController();
    startSseHeartbeat(res, ac, 100);
    expect(res.write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    vi.advanceTimersByTime(100);
    expect(res.write).toHaveBeenCalledTimes(2);
    expect((res as any).__writes[0]).toBe(': ping\n\n');
  });

  it('未传间隔时使用默认 15s', () => {
    const res = mockRes();
    const ac = new AbortController();
    startSseHeartbeat(res, ac);
    vi.advanceTimersByTime(15_000);
    expect(res.write).toHaveBeenCalledTimes(1);
  });

  it('停止函数调用后不再写帧（幂等，可重复调用）', () => {
    const res = mockRes();
    const ac = new AbortController();
    const stop = startSseHeartbeat(res, ac, 100);
    vi.advanceTimersByTime(100);
    stop();
    stop(); // 幂等
    vi.advanceTimersByTime(1000);
    expect(res.write).toHaveBeenCalledTimes(1);
  });

  it('intervalMs <= 0 直接禁用（不设定时器）', () => {
    const res = mockRes();
    const ac = new AbortController();
    const stop = startSseHeartbeat(res, ac, 0);
    stop();
    vi.advanceTimersByTime(60_000);
    expect(res.write).not.toHaveBeenCalled();
  });

  it('业务链路已 abort 后心跳自动停止', () => {
    const res = mockRes();
    const ac = new AbortController();
    startSseHeartbeat(res, ac, 100);
    ac.abort();
    vi.advanceTimersByTime(1000);
    expect(res.write).not.toHaveBeenCalled();
  });

  it('写入抛错（连接不可写）→ 停止心跳并 abort 业务链路', () => {
    const res = mockRes({ throwOnWrite: true });
    const ac = new AbortController();
    startSseHeartbeat(res, ac, 100);
    vi.advanceTimersByTime(100);
    expect(ac.signal.aborted).toBe(true);
    // 后续间隔不再写
    vi.advanceTimersByTime(1000);
    expect(res.write).toHaveBeenCalledTimes(1);
  });

  it('连接 error 事件（对端半开）→ 停止心跳并 abort 业务链路', () => {
    const res = mockRes();
    const ac = new AbortController();
    startSseHeartbeat(res, ac, 100);
    (res as any).emit('error', new Error('ECONNRESET'));
    expect(ac.signal.aborted).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(res.write).not.toHaveBeenCalled();
  });
});
