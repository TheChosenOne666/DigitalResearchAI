import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { appLogger } from './app-logger';

/** 队列积压轮询间隔（毫秒） */
const QUEUE_POLL_MS = 15_000;

/**
 * Prometheus 指标服务（M7.1）：对齐验收四项告警——
 * HTTP P95 时延、SSE 并发/断连率、BullMQ 队列积压、LLM 错误率。
 * 自持 Registry（不污染全局默认），经 MetricsController 以 text/plain 暴露。
 */
@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly registry = new Registry();
  private readonly httpDuration: Histogram<string>;
  private readonly sseActive: Gauge<string>;
  private readonly sseConnections: Counter<string>;
  private readonly sseDisconnects: Counter<string>;
  private readonly llmCalls: Counter<string>;
  private readonly queueJobs: Gauge<string>;

  private queueTimer?: NodeJS.Timeout;
  private queueClient?: Queue;
  private redis?: Redis;

  constructor(private readonly config: ConfigService) {
    this.httpDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP 请求时延（秒），route 为控制器路径模板',
      labelNames: ['method', 'route', 'status'] as const,
      buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10, 30],
      registers: [this.registry],
    });
    this.sseActive = new Gauge({
      name: 'sse_active_connections',
      help: '当前活跃 SSE 长连接数',
      registers: [this.registry],
    });
    this.sseConnections = new Counter({
      name: 'sse_connections_total',
      help: 'SSE 连接建立总数',
      registers: [this.registry],
    });
    this.sseDisconnects = new Counter({
      name: 'sse_disconnects_total',
      help: 'SSE 客户端中断总数（断连率 = disconnects / connections）',
      registers: [this.registry],
    });
    this.llmCalls = new Counter({
      name: 'llm_calls_total',
      help: 'LLM 调用计数（错误率 = status=error / total）',
      labelNames: ['scene', 'status'] as const,
      registers: [this.registry],
    });
    this.queueJobs = new Gauge({
      name: 'queue_job_counts',
      help: 'BullMQ 队列任务数（按状态）',
      labelNames: ['queue', 'state'] as const,
      registers: [this.registry],
    });
  }

  /** 启动时开始轮询队列积压 */
  onModuleInit(): void {
    this.startQueuePolling('chunk-embed');
  }

  /** 停止轮询并释放 Redis 连接 */
  onModuleDestroy(): void {
    if (this.queueTimer) clearInterval(this.queueTimer);
    void this.queueClient?.close();
    void this.redis?.quit();
  }

  /** 记录一次 HTTP 请求时延 */
  observeHttp(route: string, method: string, status: number, seconds: number): void {
    this.httpDuration.labels(method, route, String(status)).observe(seconds);
  }

  /** SSE 连接建立 */
  sseOpen(): void {
    this.sseConnections.inc();
    this.sseActive.inc();
  }

  /** SSE 连接结束；aborted=true 表示客户端主动断开 */
  sseClose(aborted: boolean): void {
    this.sseActive.dec();
    if (aborted) this.sseDisconnects.inc();
  }

  /** 记录一次 LLM 调用结果（rerank 增加 skipped：未启用/候选不足跳过） */
  llmCall(scene: 'intent' | 'report' | 'analyze' | 'rerank', status: 'ok' | 'error' | 'skipped'): void {
    this.llmCalls.labels(scene, status).inc();
  }

  /** 启动队列积压轮询（Redis 连接方式与全项目统一：REDIS_URL 直连） */
  private startQueuePolling(queueName: string): void {
    const url = this.config.get<string>('REDIS_URL', 'redis://localhost:6380');
    this.redis = new Redis(url, { maxRetriesPerRequest: 2 });
    this.queueClient = new Queue(queueName, { connection: this.redis });
    void this.refreshQueueCounts(queueName);
    this.queueTimer = setInterval(() => void this.refreshQueueCounts(queueName), QUEUE_POLL_MS);
    this.queueTimer.unref?.();
  }

  /** 拉取队列各状态任务数并刷新 Gauge */
  private async refreshQueueCounts(queueName: string): Promise<void> {
    try {
      const counts = await this.queueClient!.getJobCounts('waiting', 'active', 'completed', 'failed');
      for (const [state, value] of Object.entries(counts)) {
        this.queueJobs.labels(queueName, state).set(value);
      }
    } catch (e) {
      // Redis 短暂不可用时不让轮询异常外溢，日志留痕即可
      appLogger.pino.warn({ err: e }, '队列积压指标刷新失败');
    }
  }

  /** Prometheus 文本格式内容类型 */
  get contentType(): string {
    return this.registry.contentType;
  }

  /** 导出全部指标文本（/metrics 响应体） */
  text(): Promise<string> {
    return this.registry.metrics();
  }
}
