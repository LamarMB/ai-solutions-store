/**
 * Нагрузочный тест VK-бота «Демо-Мед» на ЛОКАЛЬНОЙ тестовой базе — без
 * ВКонтакте и OpenAI. Работает настоящий код: runLongPoll, createVkRunner,
 * бот (createDemoBot), при --model=client — OpenAiClient. Внешние сервисы —
 * заглушки в процессе: сервер Long Poll, VK API (messages.send с задержкой
 * --vk-ms) и OpenAI (задержка --model-ms). Задержки — ДОПУЩЕНИЯ, не замеры.
 *
 *   npx tsx scripts/load/bot-load.mts --db=копия.sqlite --patients=50 --duration=60 \
 *     --mode=parallel --concurrency=8 --model-ms=0 --vk-ms=100 --out=r.json
 *
 * --mode=sequential — как до изменений: события по одному, позиция Long Poll не
 *   сохраняется (--persist-ts=1 — сохраняется);
 * --mode=parallel — очередь KeyedQueue (BOT_CONCURRENCY), сохранение ts;
 * --model=client --model-ms=1500 — OpenAiClient с заглушкой (ответ не по схеме →
 *   бот продолжает по правилам: измеряется задержка и ограничение запросов);
 * --dup-rate=0.1 — доля событий, которые «ВКонтакте» доставляет повторно;
 * --vk-error-rate / --openai-error-rate — доля ответов с ошибкой (VK: код 6
 *   «слишком много запросов», OpenAI: 429);
 * --restart-at=30 --restart=graceful|hard — перезапуск обработчика на 30-й
 *   секунде замера (graceful — с завершением очереди, hard — без).
 *
 * В журнал и результаты не попадают тексты сообщений и VK ID.
 */
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import { createDemoBot } from "@/bot";
import { KeyedQueue, RateGate } from "@/bot/concurrency";
import { VkApi } from "@/bot/vk/api";
import { runLongPoll, type VkUpdate } from "@/bot/vk/longpoll";
import { createVkRunner, ERROR_TEXT, peerOf } from "@/bot/vk/runner";

const arg = (name: string, fallback?: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ??
  fallback;

const DB = arg("db")!;
const PATIENTS = Number(arg("patients", "10"));
const DURATION = Number(arg("duration", "60")) * 1000;
const WARMUP = Number(arg("warmup", "10")) * 1000;
const [THINK_MIN, THINK_MAX] = arg("think", "3000-10000")!
  .split("-")
  .map(Number);
const MODE = arg("mode", "parallel") as "parallel" | "sequential";
const CONCURRENCY = Number(arg("concurrency", "8"));
const QUEUE_LIMIT = Number(arg("queue-limit", "500"));
const VK_RPS = Number(arg("vk-rps", "0")); // 0 — без ограничения (как раньше)
const MODEL = arg("model", "none") as "none" | "client";
const MODEL_MS = Number(arg("model-ms", "0"));
const OPENAI_CONCURRENCY = Number(arg("openai-concurrency", "4"));
const VK_MS = Number(arg("vk-ms", "100"));
const DUP_RATE = Number(arg("dup-rate", "0"));
const VK_ERROR_RATE = Number(arg("vk-error-rate", "0"));
const OPENAI_ERROR_RATE = Number(arg("openai-error-rate", "0"));
const RESTART_AT = Number(arg("restart-at", "0")) * 1000;
const RESTART = arg("restart", "graceful") as "graceful" | "hard";
const PERSIST_TS = arg("persist-ts", MODE === "parallel" ? "1" : "0") === "1";
const FIRST_PEER = 9_100_001;
/** Ответ, не пришедший за это время, считается потерянным (тайм-аут). */
const REPLY_TIMEOUT_MS = 30_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

// --- Заглушка сервера Long Poll: журнал событий, ts = номер события ---------
const events: VkUpdate[] = [];
let notify: (() => void) | undefined;
let duplicatesInjected = 0;
let consumedUpTo = 0; // для длины очереди в последовательном режиме
function publish(update: VkUpdate) {
  events.push(update);
  if (DUP_RATE > 0 && Math.random() < DUP_RATE) {
    events.push(update); // ВКонтакте доставил то же событие ещё раз
    duplicatesInjected++;
  }
  notify?.();
}

async function longPollResponse(ts: number): Promise<Response> {
  if (ts >= events.length) {
    await Promise.race([new Promise<void>((r) => (notify = r)), sleep(1000)]);
  }
  const updates = events.slice(ts, ts + 100);
  consumedUpTo = Math.max(consumedUpTo, ts);
  return Response.json({ ts: String(ts + updates.length), updates });
}

// --- Заглушки VK API и OpenAI ----------------------------------------------
type Labels = { label: string; payload?: string }[];
const waiting = new Map<number, (labels: Labels | null) => void>();
const seenSends = new Set<string>();
let sends = 0;
let duplicateSends = 0;
let errorReplies = 0;
let vkErrors = 0;
let openaiCalls = 0;
let openaiErrors = 0;

const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  if (u.startsWith("http://lp.local")) {
    return longPollResponse(Number(new URL(u).searchParams.get("ts")));
  }
  if (u.startsWith("http://openai.local")) {
    openaiCalls++;
    await sleep(MODEL_MS);
    if (Math.random() < OPENAI_ERROR_RATE) {
      openaiErrors++;
      return Response.json(
        { error: { code: "rate_limit_exceeded" } },
        { status: 429 },
      );
    }
    // Ответ не по схеме: клиент отработал полностью, бот отвечает по правилам.
    return Response.json({
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: '{"action":"load_test"}' }],
        },
      ],
    });
  }
  const method = u.slice(u.lastIndexOf("/") + 1);
  if (method === "groups.getLongPollServer")
    return Response.json({
      response: {
        server: "http://lp.local/wh",
        key: "k",
        ts: String(events.length),
      },
    });
  if (method !== "messages.send") return Response.json({ response: 1 });
  await sleep(VK_MS);
  if (Math.random() < VK_ERROR_RATE) {
    vkErrors++;
    return Response.json({
      error: { error_code: 6, error_msg: "Too many requests per second" },
    });
  }
  const body = new URLSearchParams(String(init?.body ?? ""));
  sends++;
  const peer = Number(body.get("peer_id"));
  const key = `${peer}:${body.get("random_id")}`;
  if (seenSends.has(key)) duplicateSends++;
  seenSends.add(key);
  if (body.get("message") === ERROR_TEXT) errorReplies++;
  const labels: Labels = [];
  const keyboard = body.get("keyboard");
  if (keyboard)
    for (const row of JSON.parse(keyboard).buttons as {
      action: { label: string; payload?: string };
    }[][])
      for (const b of row)
        labels.push({ label: b.action.label, payload: b.action.payload });
  const w = waiting.get(peer);
  if (w) {
    waiting.delete(peer);
    w(labels);
  }
  return Response.json({ response: 1 });
}) as typeof fetch;

// --- Бот и канал — настоящий код ---------------------------------------------
const { bot, store } = createDemoBot({
  dbPath: DB,
  miniApp: true,
  // Виртуальные пациенты пишут чаще живых: лимит частоты не должен их отсекать.
  messagesPerMinute: 1000,
  openai:
    MODEL === "client"
      ? {
          apiKey: "sk-load-test-not-a-real-key-000000",
          model: "gpt-5.6-luna",
          dailyLimit: 1_000_000,
          concurrency: OPENAI_CONCURRENCY,
          baseUrl: "http://openai.local/v1",
          fetch: fakeFetch,
        }
      : undefined,
});
const api = new VkApi({
  token: "fake-token-not-real",
  version: "5.199",
  fetch: fakeFetch,
  baseUrl: "http://vk.local/method",
  sleep: (ms) => sleep(Math.min(ms, 1000)),
  gate: VK_RPS > 0 ? new RateGate(VK_RPS) : undefined,
});
const allowed = new Set(
  Array.from({ length: PATIENTS }, (_, i) => FIRST_PEER + i),
);

let maxQueue = 0;
let handlers = 0;
function startHandler() {
  handlers++;
  const controller = new AbortController();
  const runner = createVkRunner({
    api,
    bot,
    store,
    allowedUserIds: allowed,
    miniApp: { appId: 51000001, groupId: 1 },
    log: () => {},
  });
  let killed = false;
  const queue =
    MODE === "parallel"
      ? new KeyedQueue<number>({ concurrency: CONCURRENCY, limit: QUEUE_LIMIT })
      : undefined;
  const saved = PERSIST_TS
    ? store.getBotStatus().longpoll_ts?.value
    : undefined;
  const loop = runLongPoll(
    {
      api,
      groupId: 1,
      fetch: fakeFetch,
      waitSeconds: 1,
      onUpdate: async (update) => {
        if (!killed) await runner.onUpdate(update);
      },
      dispatch: queue
        ? (update) =>
            queue.push(peerOf(update), async () => {
              // Жёсткий перезапуск: задачи, не начатые до «падения», исчезают из памяти.
              if (!killed) await runner.onUpdate(update);
            })
        : undefined,
      waitForCapacity: queue ? (s) => queue.waitForCapacity(s) : undefined,
      initialTs: saved,
      onCommit: PERSIST_TS
        ? (ts) =>
            store.setBotStatus("longpoll_ts", ts, new Date().toISOString())
        : undefined,
    },
    controller.signal,
  );
  const timer = setInterval(() => {
    const q = queue
      ? queue.queued + queue.running
      : events.length - consumedUpTo;
    maxQueue = Math.max(maxQueue, q);
  }, 100);
  return {
    async stop(kind: "graceful" | "hard") {
      controller.abort();
      if (kind === "hard") killed = true;
      await loop.catch(() => {});
      if (kind === "graceful") await queue?.drain(30_000);
      clearInterval(timer);
    },
  };
}

// --- Виртуальные пациенты: закрытый цикл, пишут после ответа -----------------
let measuring = false;
const latency: number[] = [];
let timeouts = 0;
let booked = 0;
let messageId = 1;

function send(peer: number, text: string, payload?: string): Promise<Labels> {
  const id = messageId++;
  const t0 = performance.now();
  const reply = new Promise<Labels | null>((resolve) => {
    waiting.set(peer, resolve);
    setTimeout(() => {
      if (waiting.get(peer) === resolve) {
        waiting.delete(peer);
        resolve(null);
      }
    }, REPLY_TIMEOUT_MS);
  });
  publish({
    type: "message_new",
    object: {
      message: { id, from_id: peer, peer_id: peer, text, payload },
      client_info: {
        keyboard: true,
        inline_keyboard: false,
        button_actions: ["text"],
      },
    },
  });
  return reply.then((labels) => {
    if (labels === null) {
      if (measuring) timeouts++;
      return [];
    }
    if (measuring) latency.push(performance.now() - t0);
    return labels;
  });
}

const QUESTIONS = [
  "Сколько стоит приём терапевта?",
  "Где находится клиника?",
  "Какие врачи есть?",
  "Как добраться?",
];
const STOP = Symbol("stop");

async function patient(index: number, until: number) {
  const peer = FIRST_PEER + index;
  const think = async () => {
    await sleep(THINK_MIN + Math.random() * Math.max(0, THINK_MAX - THINK_MIN));
    if (performance.now() >= until) throw STOP;
  };
  const press = (labels: Labels, match: RegExp) => {
    const b = labels.find((l) => match.test(l.label));
    return b ? send(peer, b.label, b.payload) : send(peer, "В меню");
  };
  try {
    for (;;) {
      await send(peer, pick(QUESTIONS));
      await think();
      let labels = await send(peer, "Хочу записаться к терапевту");
      await think();
      labels = await press(labels, /Тестова|Примеров/);
      await think();
      labels = await press(labels, /^(пн|вт|ср|чт|пт|сб), /);
      await think();
      labels = await press(labels, /^\d\d:\d\d$/);
      await think();
      labels = await press(labels, /^Подтвердить$/);
      if (labels.some((l) => /Мои записи/.test(l.label)) && measuring) booked++;
      await think();
      labels = await send(peer, "мои записи");
      await think();
      if (Math.random() < 0.5) {
        labels = await press(labels, /^Отменить №/);
        await think();
        await press(labels, /^Да, отменить$/);
        await think();
      }
    }
  } catch (e) {
    if (e !== STOP) throw e;
  }
}

// --- Запуск и замеры ------------------------------------------------------------
let handler = startHandler();
const cpu0 = process.cpuUsage();
const start = performance.now();
const until = start + WARMUP + DURATION;
let sendsAtStart = 0;
let sendsInWindow = 0;
setTimeout(() => {
  measuring = true;
  sendsAtStart = sends;
}, WARMUP);
setTimeout(() => {
  measuring = false;
  sendsInWindow = sends - sendsAtStart;
}, WARMUP + DURATION);
let restartReport: Record<string, unknown> | undefined;
if (RESTART_AT > 0) {
  setTimeout(async () => {
    const t0 = performance.now();
    const pending = events.length - consumedUpTo;
    await handler.stop(RESTART);
    handler = startHandler();
    restartReport = {
      kind: RESTART,
      unreadEventsAtRestart: pending,
      pausedMs: performance.now() - t0,
    };
  }, WARMUP + RESTART_AT);
}
let rssMax = 0;
const rssTimer = setInterval(() => {
  rssMax = Math.max(rssMax, process.memoryUsage().rss);
}, 1000);
await Promise.all(
  Array.from({ length: PATIENTS }, (_, i) =>
    sleep((i / PATIENTS) * (WARMUP / 2)).then(() => patient(i, until)),
  ),
);
await handler.stop("graceful");
clearInterval(rssTimer);
const cpu = process.cpuUsage(cpu0);
const seconds = (performance.now() - start) / 1000;

store.close();
const check = new DatabaseSync(DB);
const doubles = (
  check
    .prepare(
      `SELECT COUNT(*) AS n FROM (SELECT 1 FROM bookings WHERE cancelled_at IS NULL
       GROUP BY doctor_id, date, time HAVING COUNT(*) > 1)`,
    )
    .get() as { n: number }
).n;
const processed = (
  check.prepare("SELECT COUNT(*) AS n FROM processed_events").get() as {
    n: number;
  }
).n;
check.close();

const sorted = [...latency].sort((a, b) => a - b);
const pct = (p: number) =>
  sorted.length
    ? sorted[
        Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
      ]
    : null;
const out = {
  mode: MODE,
  concurrency: MODE === "parallel" ? CONCURRENCY : 1,
  patients: PATIENTS,
  model: MODEL,
  modelMs: MODEL_MS,
  vkMs: VK_MS,
  vkRps: VK_RPS,
  think: [THINK_MIN, THINK_MAX],
  replies: sorted.length,
  repliesPerSec: sorted.length / (DURATION / 1000),
  sendsPerSec: sendsInWindow / (DURATION / 1000),
  p50: pct(50),
  p95: pct(95),
  p99: pct(99),
  max: sorted.at(-1) ?? null,
  timeouts,
  errorRate: (timeouts + errorReplies) / Math.max(1, sorted.length + timeouts),
  errorReplies,
  maxQueue,
  booked,
  doubleBookings: doubles,
  duplicatesInjected,
  duplicateSends,
  vkErrors,
  openaiCalls,
  openaiErrors,
  eventsPublished: events.length,
  uniqueEventsProcessed: processed,
  handlers,
  restart: restartReport,
  cpuPercent: ((cpu.user + cpu.system) / 1000 / (seconds * 1000)) * 100,
  rssMaxMB: rssMax / 1024 / 1024,
};
const file = arg("out");
if (file) writeFileSync(file, JSON.stringify(out, null, 1));
const f = (v: number | null) => (v == null ? "-" : v.toFixed(0));
console.log(
  `бот[${MODE}${MODE === "parallel" ? `×${CONCURRENCY}` : ""}${MODEL === "client" ? `, модель ${MODEL_MS}мс` : ""}]: ` +
    `пациентов=${PATIENTS} ответов/с=${out.repliesPerSec.toFixed(2)} p50=${f(out.p50)} p95=${f(out.p95)} p99=${f(out.p99)} ` +
    `очередь≤${maxQueue} тайм-аутов=${timeouts} ошибок=${errorReplies} cpu=${out.cpuPercent.toFixed(0)}% ` +
    `rss=${out.rssMaxMB.toFixed(0)}MB записей=${booked} двойных=${doubles} повторных отправок=${duplicateSends}`,
);
process.exit(0);
