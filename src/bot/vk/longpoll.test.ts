import { describe, expect, it, vi } from "vitest";
import { VkApiError, type VkApi } from "@/bot/vk/api";
import { runLongPoll, type VkUpdate } from "@/bot/vk/longpoll";

type PollStep = Record<string, unknown> | Error;

/**
 * Поддельные VK API и сервер Long Poll. Когда сценарий заканчивается,
 * цикл останавливается через AbortController.
 */
function setup(serverReplies: unknown[], pollSteps: PollStep[]) {
  const controller = new AbortController();
  const serverCalls: number[] = [];
  const api = {
    call: vi.fn(async (method: string) => {
      expect(method).toBe("groups.getLongPollServer");
      serverCalls.push(serverCalls.length);
      const next = serverReplies.shift();
      if (next instanceof Error) throw next;
      return next;
    }),
  } as unknown as VkApi;
  const polled: URL[] = [];
  const fetch = vi.fn(async (url: string | URL | Request) => {
    polled.push(new URL(String(url)));
    const step = pollSteps.shift();
    if (!step) {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    }
    if (step instanceof Error) throw step;
    return new Response(JSON.stringify(step));
  });
  const updates: VkUpdate[] = [];
  const sleep = vi.fn(async (ms: number) => {
    void ms;
  });
  const run = () =>
    runLongPoll(
      {
        api,
        groupId: 242364009,
        onUpdate: async (update) => {
          updates.push(update);
        },
        fetch: fetch as typeof globalThis.fetch,
        sleep,
      },
      controller.signal,
    );
  return { run, polled, updates, serverCalls, sleep };
}

const server = (key: string, ts: string) => ({
  server: "https://lp.vk.test/wh1",
  key,
  ts,
});
const update = (id: string): VkUpdate => ({
  type: "message_new",
  event_id: id,
  object: {},
});

describe("Bots Long Poll", () => {
  it("получает события и сдвигает ts", async () => {
    const t = setup(
      [server("k1", "10")],
      [
        { ts: "11", updates: [update("a"), update("b")] },
        { ts: "12", updates: [] },
      ],
    );
    await t.run();
    expect(t.updates.map((u) => u.event_id)).toEqual(["a", "b"]);
    expect(t.polled.map((u) => u.searchParams.get("ts"))).toEqual([
      "10",
      "11",
      "12",
    ]);
    expect(t.polled[0].searchParams.get("act")).toBe("a_check");
  });

  it("failed 1 — новый ts; failed 2 — новый ключ с прежним ts; failed 3 — новый ключ и ts", async () => {
    const t = setup(
      [server("k1", "10"), server("k2", "99"), server("k3", "50")],
      [
        { failed: 1, ts: "20" },
        { failed: 2 },
        { failed: 3 },
        { ts: "51", updates: [] },
      ],
    );
    await t.run();
    expect(
      t.polled.map((u) => [
        u.searchParams.get("key"),
        u.searchParams.get("ts"),
      ]),
    ).toEqual([
      ["k1", "10"],
      ["k1", "20"],
      ["k2", "20"],
      ["k3", "50"],
      ["k3", "51"],
    ]);
  });

  it("после обрыва связи — пауза и переподключение с прежним ts", async () => {
    const t = setup(
      [server("k1", "10"), new TypeError("fetch failed"), server("k2", "77")],
      [
        { ts: "11", updates: [] },
        new TypeError("fetch failed"),
        { ts: "12", updates: [update("c")] },
      ],
    );
    await t.run();
    expect(t.sleep).toHaveBeenCalledTimes(2);
    // Пауза растёт: 1 с, затем 2 с.
    expect(t.sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
    expect(t.polled.at(-2)?.searchParams.get("key")).toBe("k2");
    // События за время обрыва не теряются: запрос идёт с прежним ts, а не с новым.
    expect(t.polled.at(-2)?.searchParams.get("ts")).toBe("11");
    expect(t.updates.map((u) => u.event_id)).toEqual(["c"]);
  });

  it("ошибка доступа останавливает цикл", async () => {
    const t = setup(
      [
        new VkApiError(
          5,
          "User authorization failed",
          "groups.getLongPollServer",
        ),
      ],
      [],
    );
    await expect(t.run()).rejects.toMatchObject({ code: 5 });
  });

  it("событие, на котором упала обработка, придёт снова: ts не сдвигается", async () => {
    const controller = new AbortController();
    const steps: unknown[] = [
      { ts: "11", updates: [update("x")] },
      { ts: "11", updates: [update("x")] },
    ];
    const tsSeen: (string | null)[] = [];
    let attempts = 0;
    await runLongPoll(
      {
        api: {
          call: async () => server("k", "10"),
        } as unknown as VkApi,
        groupId: 1,
        fetch: (async (url: string) => {
          tsSeen.push(new URL(url).searchParams.get("ts"));
          const step = steps.shift();
          if (!step) {
            controller.abort();
            throw new DOMException("aborted", "AbortError");
          }
          return new Response(JSON.stringify(step));
        }) as typeof fetch,
        sleep: async () => {},
        onUpdate: async () => {
          if (attempts++ === 0) throw new Error("db busy");
        },
      },
      controller.signal,
    );
    expect(attempts).toBe(2);
    expect(tsSeen).toEqual(["10", "10", "11"]);
  });
});

describe("Bots Long Poll: параллельная обработка", () => {
  /** Сервер с заданными ответами; события завершает сам тест. */
  function parallel(
    steps: unknown[],
    options: { initialTs?: string; capacity?: () => Promise<void> } = {},
  ) {
    const controller = new AbortController();
    const polled: (string | null)[] = [];
    const pending = new Map<string, () => void>();
    const committed: string[] = [];
    let capacityChecks = 0;
    const run = runLongPoll(
      {
        api: { call: async () => server("k", "10") } as unknown as VkApi,
        groupId: 1,
        fetch: (async (url: string) => {
          polled.push(new URL(url).searchParams.get("ts"));
          const step = steps.shift();
          if (!step) {
            // Ждём остановки: как сервер, который держит запрос без событий.
            await new Promise((r) =>
              controller.signal.addEventListener("abort", r, { once: true }),
            );
            throw new DOMException("aborted", "AbortError");
          }
          return new Response(JSON.stringify(step));
        }) as typeof fetch,
        sleep: async () => {},
        onUpdate: async () => {
          throw new Error("в параллельном режиме не используется");
        },
        dispatch: (u) =>
          new Promise<void>((done) => pending.set(u.event_id!, done)),
        waitForCapacity: async () => {
          capacityChecks++;
          await options.capacity?.();
        },
        initialTs: options.initialTs,
        onCommit: (ts) => committed.push(ts),
      },
      controller.signal,
    );
    return {
      run,
      polled,
      pending,
      committed,
      stop: () => controller.abort(),
      capacityChecks: () => capacityChecks,
    };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("следующая пачка запрашивается, не дожидаясь обработки; ts фиксируется по порядку пачек", async () => {
    const t = parallel([
      { ts: "11", updates: [update("a"), update("b")] },
      { ts: "12", updates: [update("c")] },
    ]);
    await tick();
    // Обе пачки получены, хотя ни одно событие ещё не обработано.
    expect(t.polled).toEqual(["10", "11", "12"]);
    expect([...t.pending.keys()]).toEqual(["a", "b", "c"]);
    expect(t.committed).toEqual([]);
    // Вторая пачка готова раньше первой — фиксировать её ts ещё нельзя.
    t.pending.get("c")!();
    await tick();
    expect(t.committed).toEqual([]);
    t.pending.get("a")!();
    await tick();
    expect(t.committed).toEqual([]);
    t.pending.get("b")!();
    await tick();
    expect(t.committed).toEqual(["12"]);
    expect(t.capacityChecks()).toBe(2);
    t.stop();
    await t.run;
  });

  it("после перезапуска продолжает с сохранённого ts", async () => {
    const t = parallel([{ ts: "8", updates: [] }], { initialTs: "7" });
    await tick();
    expect(t.polled[0]).toBe("7");
    expect(t.committed).toEqual(["8"]);
    t.stop();
    await t.run;
  });

  it("очередь заполнена — новые события не запрашиваются, пока нет места", async () => {
    let free!: () => void;
    const room = new Promise<void>((r) => (free = r));
    const t = parallel(
      [
        { ts: "11", updates: [update("a")] },
        { ts: "12", updates: [] },
      ],
      { capacity: () => room },
    );
    await tick();
    expect(t.polled).toEqual(["10"]);
    free();
    await tick();
    expect(t.polled).toEqual(["10", "11", "12"]);
    t.pending.get("a")!();
    t.stop();
    await t.run;
  });
});
