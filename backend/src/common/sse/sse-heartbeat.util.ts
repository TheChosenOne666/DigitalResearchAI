import type { Response } from 'express';

/** SSE 心跳默认间隔（毫秒）：低于常见反向代理 60s 空闲超时 */
export const SSE_HEARTBEAT_DEFAULT_MS = 15_000;

/**
 * 启动 SSE 心跳（中优先级优化）：按固定间隔向响应写入 SSE 注释帧（`: ping\n\n`），
 * 防止网关/反向代理因空闲超时掐断半开连接（生成阶段 LLM 可能长时间无输出）。
 *
 * - 注释帧是 SSE 规范定义的合法帧，标准客户端自动忽略（本项目前端 search/workspace 两个流解析器均已跳过 ':' 开头行，前端零改动）
 * - 连接异常（对端半开/已销毁）时 write 抛错或触发 res 的 error 事件：停止心跳并 abort 业务链路，尽早释放资源
 * - 返回停止函数：响应结束（finally）时必须调用以清理定时器，避免泄漏
 *
 * @param res Express 响应（已写出 SSE 响应头）
 * @param ac 业务链路的中止控制器（心跳发现死连接时触发，与 res 'close' 监听互补）
 * @param intervalMs 心跳间隔毫秒；<= 0 禁用心跳（直接返回空操作）
 * @returns 停止函数（幂等，可重复调用）
 */
export function startSseHeartbeat(
  res: Response,
  ac: AbortController,
  intervalMs: number = SSE_HEARTBEAT_DEFAULT_MS,
): () => void {
  if (intervalMs <= 0) return () => undefined;
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };
  const timer = setInterval(() => {
    if (stopped || ac.signal.aborted) {
      stop();
      return;
    }
    try {
      res.write(': ping\n\n');
    } catch {
      // 连接已不可写：停止心跳并中止业务链路（后续 res.write 由调用方 finally 收口）
      stop();
      if (!ac.signal.aborted) ac.abort();
    }
  }, intervalMs);
  // 对端半开时 write 可能不抛错而是触发 error 事件：兜底监听，防止未处理 error 崩进程
  res.on('error', () => {
    stop();
    if (!ac.signal.aborted) ac.abort();
  });
  return stop;
}
