import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSolutions } from "@/catalog";
import {
  createIdempotencyCache,
  createRateLimiter,
} from "@/requests/rate-limit";
import {
  handleSubmission,
  MIN_FILL_MS,
  type SubmitDeps,
} from "@/requests/service";
import type { SubmitState } from "@/requests/state";
import {
  getRequestStore,
  TestRequestStore,
  type RequestRecord,
} from "@/requests/store";

const NOW = 1_800_000_000_000;
const UUID = "123e4567-e89b-42d3-a456-426614174000";

function makeForm(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const fields: Record<string, string> = {
    name: "Анна",
    company: "",
    contactMethod: "email",
    contact: "anna@example.com",
    message: "Нужно автоматизировать обработку счетов.",
    consent: "on",
    website: "",
    startedAt: String(NOW - 10_000),
    submissionId: UUID,
    ...overrides,
  };
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

class RecordingStore extends TestRequestStore {
  saved: RequestRecord[] = [];
  override async save(record: RequestRecord) {
    this.saved.push(record);
    await super.save(record);
  }
}

let store: RecordingStore;
let logs: string[];
let deps: SubmitDeps;
let ids = 0;

beforeEach(() => {
  store = new RecordingStore();
  logs = [];
  ids = 0;
  deps = {
    store,
    limiter: createRateLimiter({ limit: 3, windowMs: 60_000, now: () => NOW }),
    idempotency: createIdempotencyCache<SubmitState>({
      ttlMs: 60_000,
      now: () => NOW,
    }),
    solutions: getSolutions(),
    clientKey: "client-a",
    now: () => NOW,
    newId: () => `req-${++ids}`,
    log: (m) => logs.push(m),
  };
});

describe("handleSubmission", () => {
  it("принимает корректную общую заявку в тестовом режиме", async () => {
    const r = await handleSubmission(makeForm(), deps);
    expect(r).toEqual({ status: "accepted", mode: "test", reference: "req-1" });
    expect(store.saved[0].items).toEqual([]);
  });

  it("сохраняет минимальный набор данных без служебных полей", async () => {
    await handleSubmission(
      makeForm({ solutionId: "document-data-extraction", packageId: "pilot" }),
      deps,
    );
    const record = store.saved[0];
    expect(Object.keys(record).sort()).toEqual(
      ["contact", "createdAt", "id", "items", "message"].sort(),
    );
    expect(record.items).toEqual([
      { solutionId: "document-data-extraction", packageId: "pilot" },
    ]);
    expect(record.contact).toEqual({
      name: "Анна",
      method: "email",
      value: "anna@example.com",
    });
    expect(JSON.stringify(record)).not.toMatch(
      /website|startedAt|submissionId/,
    );
  });

  it("неизвестное решение → общая заявка; чужой пакет отбрасывается", async () => {
    await handleSubmission(makeForm({ solutionId: "nope" }), deps);
    expect(store.saved[0].items).toEqual([]);
    await handleSubmission(
      makeForm({
        solutionId: "crm-ai-integration",
        packageId: "turnkey",
        submissionId: "223e4567-e89b-42d3-a456-426614174000",
      }),
      deps,
    );
    expect(store.saved[1].items).toEqual([
      { solutionId: "crm-ai-integration", packageId: null },
    ]);
  });

  it("не пишет контакты, имя и текст заявки в лог", async () => {
    await handleSubmission(makeForm({ company: "ООО Ромашка" }), deps);
    const all = logs.join("\n");
    expect(all).toContain("id=req-1");
    expect(all).not.toMatch(/anna@example\.com|Анна|Ромашка|счетов/);
  });

  it("повторная отправка с тем же ключом не создаёт вторую заявку", async () => {
    const first = await handleSubmission(makeForm(), deps);
    const second = await handleSubmission(makeForm(), deps);
    expect(second).toEqual(first);
    expect(store.saved).toHaveLength(1);
  });

  it("невалидные данные: ошибки полей, ничего не сохраняется", async () => {
    const r = await handleSubmission(
      makeForm({ contact: "bad", consent: "" }),
      deps,
    );
    expect(r.status).toBe("invalid");
    if (r.status !== "invalid") return;
    expect(Object.keys(r.fieldErrors).sort()).toEqual(["consent", "contact"]);
    expect(store.saved).toHaveLength(0);
  });

  it("после исправления ошибок та же форма отправляется", async () => {
    await handleSubmission(makeForm({ contact: "bad" }), deps);
    const r = await handleSubmission(makeForm(), deps);
    expect(r.status).toBe("accepted");
  });

  it("ловушка для ботов: ответ как обычно, но ничего не сохраняется", async () => {
    const r = await handleSubmission(
      makeForm({ website: "http://spam" }),
      deps,
    );
    expect(r.status).toBe("accepted");
    expect(store.saved).toHaveLength(0);
  });

  it("слишком быстрое заполнение отклоняется", async () => {
    const r = await handleSubmission(
      makeForm({ startedAt: String(NOW - MIN_FILL_MS + 1) }),
      deps,
    );
    expect(r.status).toBe("too_fast");
    expect(store.saved).toHaveLength(0);
  });

  it("устаревшая или подделанная метка времени отклоняется", async () => {
    for (const startedAt of ["abc", String(NOW - 25 * 3600 * 1000)]) {
      const r = await handleSubmission(
        makeForm({ startedAt, submissionId: crypto.randomUUID() }),
        deps,
      );
      expect(r.status).toBe("error");
    }
  });

  it("без корректного ключа отправки — ошибка", async () => {
    const r = await handleSubmission(makeForm({ submissionId: "x" }), deps);
    expect(r.status).toBe("error");
  });

  it("ограничение частоты по клиенту", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(
        await handleSubmission(
          makeForm({ submissionId: crypto.randomUUID() }),
          deps,
        ),
      );
    }
    expect(results.map((r) => r.status)).toEqual([
      "accepted",
      "accepted",
      "accepted",
      "rate_limited",
    ]);
    const other = await handleSubmission(
      makeForm({ submissionId: crypto.randomUUID() }),
      { ...deps, clientKey: "client-b" },
    );
    expect(other.status).toBe("accepted");
  });

  it("ошибка хранилища — понятное сообщение без деталей", async () => {
    store.save = vi
      .fn()
      .mockRejectedValue(new Error("db down: anna@example.com"));
    const r = await handleSubmission(makeForm(), deps);
    expect(r).toEqual({
      status: "error",
      message: "Не удалось обработать заявку. Попробуйте позже.",
    });
    expect(logs.join()).not.toContain("anna@example.com");
  });
});

describe("TestRequestStore", () => {
  it("не хранит данные заявки — только счётчик", async () => {
    const s = new TestRequestStore();
    await s.save({
      id: "x",
      createdAt: "",
      items: [],
      contact: { name: "Анна", method: "email", value: "a@b.c" },
      message: "текст",
    });
    expect(s.acceptedCount).toBe(1);
    expect(JSON.stringify(s)).not.toContain("a@b.c");
  });
});

describe("getRequestStore", () => {
  it("всегда тестовый адаптер: переменные окружения не включают сохранение", () => {
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@db/requests");
    vi.stubEnv("REQUEST_STORE", "database");
    try {
      const store = getRequestStore();
      expect(store).toBeInstanceOf(TestRequestStore);
      expect(store.mode).toBe("test");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("rate limiter", () => {
  it("окно сдвигается со временем", () => {
    let t = 0;
    const l = createRateLimiter({ limit: 1, windowMs: 1000, now: () => t });
    expect(l.attempt("k")).toBe(true);
    expect(l.attempt("k")).toBe(false);
    t = 1000;
    expect(l.attempt("k")).toBe(true);
  });
});
