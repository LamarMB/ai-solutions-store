/**
 * Примитивы параллельной обработки бота — без внешних сервисов, в памяти
 * процесса:
 * - KeyedQueue — события разных пациентов параллельно, одного — строго по
 *   порядку; общий предел параллельности и лимит очереди;
 * - RateGate — не больше N запусков в секунду (лимит VK API);
 * - Semaphore — не больше N одновременных вызовов (OpenAI).
 */

type Job = {
  run: () => Promise<void>;
  done: () => void;
};

type Lane = { jobs: Job[]; running: boolean; ready: boolean };

export type KeyedQueueOptions = {
  /** Сколько ключей (пациентов) обрабатывается одновременно. */
  concurrency: number;
  /** Сколько событий может ждать в очереди; выше — обратное давление. */
  limit: number;
  /** Ошибка задачи — без данных события (задача сама пишет подробности). */
  onError?: (error: unknown) => void;
};

/**
 * Очередь с ключами: задачи одного ключа выполняются последовательно в порядке
 * добавления, разных ключей — параллельно, но не больше `concurrency` сразу.
 * Готовые ключи берутся по кругу, поэтому один пациент с длинной очередью не
 * задерживает остальных.
 */
export class KeyedQueue<K> {
  private readonly lanes = new Map<K, Lane>();
  private readonly ready: K[] = [];
  private active = 0;
  private waiting = 0;
  private peak = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: KeyedQueueOptions) {
    if (options.concurrency < 1) throw new Error("concurrency must be >= 1");
  }

  /** Событий в ожидании (без выполняемых). */
  get queued(): number {
    return this.waiting;
  }

  /** Выполняется сейчас. */
  get running(): number {
    return this.active;
  }

  /** Наибольшая длина очереди с момента создания. */
  get maxQueued(): number {
    return this.peak;
  }

  /** Есть ли место: при `false` источник событий должен подождать. */
  get hasCapacity(): boolean {
    return this.waiting < this.options.limit;
  }

  /** Добавляет задачу; промис выполняется, когда она завершена (не отклоняется). */
  push(key: K, run: () => Promise<void>): Promise<void> {
    return new Promise<void>((done) => {
      let lane = this.lanes.get(key);
      if (!lane) {
        lane = { jobs: [], running: false, ready: false };
        this.lanes.set(key, lane);
      }
      lane.jobs.push({ run, done });
      this.waiting += 1;
      this.peak = Math.max(this.peak, this.waiting);
      if (!lane.running && !lane.ready) {
        lane.ready = true;
        this.ready.push(key);
      }
      this.pump();
    });
  }

  private pump(): void {
    while (this.active < this.options.concurrency && this.ready.length > 0) {
      const key = this.ready.shift()!;
      const lane = this.lanes.get(key)!;
      lane.ready = false;
      const job = lane.jobs.shift()!;
      lane.running = true;
      this.active += 1;
      this.waiting -= 1;
      void this.execute(key, lane, job);
    }
  }

  private async execute(key: K, lane: Lane, job: Job): Promise<void> {
    try {
      await job.run();
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.active -= 1;
      lane.running = false;
      if (lane.jobs.length > 0) {
        lane.ready = true;
        this.ready.push(key);
      } else {
        this.lanes.delete(key);
      }
      job.done();
      this.pump();
      for (const listener of [...this.listeners]) listener();
    }
  }

  private waitFor(
    condition: () => boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    if (condition() || signal?.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const check = () => {
        if (condition() || signal?.aborted) {
          this.listeners.delete(check);
          signal?.removeEventListener("abort", check);
          resolve();
        }
      };
      this.listeners.add(check);
      signal?.addEventListener("abort", check, { once: true });
    });
  }

  /** Ждёт, пока в очереди появится место (или остановки по signal). */
  waitForCapacity(signal?: AbortSignal): Promise<void> {
    return this.waitFor(() => this.hasCapacity, signal);
  }

  /**
   * Ждёт завершения всех задач. true — очередь пуста; false — не успели за
   * timeoutMs (оставшиеся задачи продолжают выполняться).
   */
  async drain(timeoutMs: number): Promise<boolean> {
    const empty = () => this.active === 0 && this.waiting === 0;
    if (empty()) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const result = await Promise.race([
      this.waitFor(empty).then(() => true as const),
      timeout,
    ]);
    clearTimeout(timer);
    return result;
  }
}

/**
 * Не больше `perSecond` запусков за любую секунду: вызовы ждут своей очереди.
 * Нужен для лимита VK API (для ключа сообщества — до 20 запросов в секунду).
 */
export class RateGate {
  private readonly starts: number[] = [];
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly perSecond: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {
    if (perSecond < 1) throw new Error("perSecond must be >= 1");
  }

  /** Резервирует место; вызовы обслуживаются строго по порядку. */
  take(): Promise<void> {
    const next = this.tail.then(async () => {
      for (;;) {
        const t = this.now();
        while (this.starts.length > 0 && t - this.starts[0] >= 1000)
          this.starts.shift();
        if (this.starts.length < this.perSecond) {
          this.starts.push(t);
          return;
        }
        await this.sleep(1000 - (t - this.starts[0]) + 1);
      }
    });
    this.tail = next;
    return next;
  }
}

/** Не больше `limit` одновременных владельцев; ожидание — с тайм-аутом. */
export class Semaphore {
  private held = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly limit: number) {
    if (limit < 1) throw new Error("limit must be >= 1");
  }

  get inUse(): number {
    return this.held;
  }

  /**
   * Возвращает функцию освобождения или undefined, если место не освободилось
   * за waitMs (тогда вызов лучше пропустить, а не ждать дальше).
   */
  async acquire(waitMs: number): Promise<(() => void) | undefined> {
    if (this.held < this.limit) {
      this.held += 1;
      return this.releaser();
    }
    return new Promise((resolve) => {
      const grant = () => {
        clearTimeout(timer);
        this.held += 1;
        resolve(this.releaser());
      };
      const timer = setTimeout(() => {
        const i = this.queue.indexOf(grant);
        if (i >= 0) this.queue.splice(i, 1);
        resolve(undefined);
      }, waitMs);
      this.queue.push(grant);
    });
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.held -= 1;
      this.queue.shift()?.();
    };
  }
}
