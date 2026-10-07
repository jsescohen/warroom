import type { Priority } from '../../shared/ai/tasks';

export class QueueRejected extends Error {
  constructor(readonly reason: 'cooldown' | 'busy', readonly retryInMs: number) {
    super(reason === 'cooldown' ? `Actor on cooldown for ${retryInMs}ms` : 'AI queue is full');
  }
}

interface Job {
  run: () => Promise<unknown>;
  priority: Priority;
  resolve: (v: any) => void;
  reject: (e: unknown) => void;
}

export interface QueueOptions {
  minIntervalMs: number;
  maxConcurrent: number;
  actorCooldownMs: number;
  maxQueuedAi: number;
}

/**
 * Serialises LLM calls so we stay inside rate limits:
 *  - player-initiated requests always go before AI-nation requests
 *  - a minimum gap between request starts (free tiers count requests per minute)
 *  - AI nations get a per-actor cooldown and are dropped when the queue is already busy
 *  - a provider 429 pauses the whole queue for the retry-after period
 */
export class RequestQueue {
  private jobs: Job[] = [];
  private active = 0;
  private lastStart = 0;
  private pausedUntil = 0;
  private actorLast = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private opts: QueueOptions) {}

  get length() {
    return this.jobs.length;
  }

  /** Throws QueueRejected synchronously-ish (rejected promise) if an AI request should be skipped. */
  schedule<T>(run: () => Promise<T>, priority: Priority, actor?: string): Promise<T> {
    if (priority === 'ai') {
      const now = Date.now();
      if (actor) {
        const last = this.actorLast.get(actor) ?? 0;
        const wait = last + this.opts.actorCooldownMs - now;
        if (wait > 0) return Promise.reject(new QueueRejected('cooldown', wait));
        this.actorLast.set(actor, now);
      }
      if (this.jobs.filter((j) => j.priority === 'ai').length >= this.opts.maxQueuedAi)
        return Promise.reject(new QueueRejected('busy', this.opts.minIntervalMs * this.jobs.length + 1000));
    }
    return new Promise<T>((resolve, reject) => {
      const job: Job = { run, priority, resolve, reject };
      // player jobs go after other player jobs but before any AI job
      const idx = priority === 'player' ? this.jobs.findIndex((j) => j.priority === 'ai') : -1;
      if (idx < 0) this.jobs.push(job);
      else this.jobs.splice(idx, 0, job);
      this.pump();
    });
  }

  /** Called when the provider reports a rate limit. */
  pause(ms: number) {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
  }

  private pump() {
    if (this.timer) return;
    while (this.jobs.length && this.active < this.opts.maxConcurrent) {
      const wait = Math.max(this.pausedUntil, this.lastStart + this.opts.minIntervalMs) - Date.now();
      if (wait > 0) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.pump();
        }, wait);
        return;
      }
      const job = this.jobs.shift()!;
      this.active++;
      this.lastStart = Date.now();
      job.run().then(job.resolve, job.reject).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }
}
