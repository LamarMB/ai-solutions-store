import { describe, expect, it } from "vitest";
import { KeyedQueue, RateGate, Semaphore } from "@/bot/concurrency";

const tick = () => new Promise((r) => setTimeout(r, 0));
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Задача, которую тест завершает сам: так видно, что выполняется одновременно. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return { open, opened };
}

describe("KeyedQueue", () => {
  it("один ключ — строго по порядку, даже если ранняя задача медленнее", async () => {
    const q = new KeyedQueue<number>({ concurrency: 8, limit: 100 });
    const order: string[] = [];
    await Promise.all([
      q.push(1, async () => {
        await delay(20);
        order.push("a");
      }),
      q.push(1, async () => {
        order.push("b");
      }),
      q.push(1, async () => {
        await delay(5);
        order.push("c");
      }),
    ]);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("разные ключи — параллельно, но не больше concurrency", async () => {
    const q = new KeyedQueue<number>({ concurrency: 3, limit: 100 });
    const gates = Array.from({ length: 5 }, gate);
    let peak = 0;
    const done = gates.map((g, i) =>
      q.push(i, async () => {
        peak = Math.max(peak, q.running);
        await g.opened;
      }),
    );
    await tick();
    expect(q.running).toBe(3);
    expect(q.queued).toBe(2);
    for (const g of gates) g.open();
    await Promise.all(done);
    expect(peak).toBe(3);
    expect(q.running).toBe(0);
  });

  it("длинная очередь одного пациента не задерживает другого", async () => {
    const q = new KeyedQueue<number>({ concurrency: 2, limit: 100 });
    const finished: number[] = [];
    const slow = Array.from({ length: 5 }, () =>
      q.push(1, async () => {
        await delay(10);
        finished.push(1);
      }),
    );
    const fast = q.push(2, async () => {
      finished.push(2);
    });
    await fast;
    expect(finished).toEqual([2]);
    await Promise.all(slow);
  });

  it("ошибка задачи не останавливает очередь ключа", async () => {
    const errors: unknown[] = [];
    const q = new KeyedQueue<number>({
      concurrency: 2,
      limit: 100,
      onError: (e) => errors.push(e),
    });
    const order: string[] = [];
    await Promise.all([
      q.push(1, async () => {
        throw new Error("boom");
      }),
      q.push(1, async () => {
        order.push("after");
      }),
    ]);
    expect(order).toEqual(["after"]);
    expect(errors).toHaveLength(1);
  });

  it("лимит очереди: hasCapacity и ожидание места", async () => {
    const q = new KeyedQueue<number>({ concurrency: 1, limit: 2 });
    const g = gate();
    const jobs = [
      q.push(1, () => g.opened),
      q.push(2, async () => {}),
      q.push(3, async () => {}),
    ];
    await tick();
    expect(q.queued).toBe(2);
    expect(q.hasCapacity).toBe(false);
    let resumed = false;
    const waiting = q.waitForCapacity().then(() => (resumed = true));
    await tick();
    expect(resumed).toBe(false);
    g.open();
    await waiting;
    expect(resumed).toBe(true);
    await Promise.all(jobs);
    expect(q.maxQueued).toBe(2);
  });

  it("ожидание места прерывается остановкой", async () => {
    const q = new KeyedQueue<number>({ concurrency: 1, limit: 1 });
    const g = gate();
    void q.push(1, () => g.opened);
    void q.push(2, async () => {});
    await tick();
    const controller = new AbortController();
    const waiting = q.waitForCapacity(controller.signal);
    controller.abort();
    await waiting;
    g.open();
  });

  it("drain ждёт все задачи; по тайм-ауту — false", async () => {
    const q = new KeyedQueue<number>({ concurrency: 2, limit: 100 });
    const g = gate();
    void q.push(1, () => g.opened);
    void q.push(1, async () => {});
    expect(await q.drain(20)).toBe(false);
    g.open();
    expect(await q.drain(1000)).toBe(true);
    expect(q.running + q.queued).toBe(0);
  });
});

describe("RateGate", () => {
  it("не больше N запусков за секунду", async () => {
    let now = 0;
    const slept: number[] = [];
    const rate = new RateGate(
      2,
      () => now,
      async (ms) => {
        slept.push(ms);
        now += ms;
      },
    );
    const starts: number[] = [];
    for (let i = 0; i < 5; i++) {
      await rate.take();
      starts.push(now);
    }
    // Третий и пятый ждут, пока старт секундной давности выйдет из окна.
    expect(starts).toEqual([0, 0, 1001, 1001, 2002]);
    expect(slept.length).toBe(2);
  });
});

describe("Semaphore", () => {
  it("не больше limit владельцев; ожидание по тайм-ауту — undefined", async () => {
    const s = new Semaphore(2);
    const a = await s.acquire(10);
    const b = await s.acquire(10);
    expect(s.inUse).toBe(2);
    expect(await s.acquire(10)).toBeUndefined();
    const waiting = s.acquire(1000);
    a!();
    const c = await waiting;
    expect(c).toBeDefined();
    expect(s.inUse).toBe(2);
    b!();
    c!();
    c!(); // повторное освобождение ничего не ломает
    expect(s.inUse).toBe(0);
  });
});
