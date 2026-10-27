/**
 * Нагрузочный тест VK-бота «Демо-Мед» на ЛОКАЛЬНОЙ тестовой базе — без
 * ВКонтакте и OpenAI. Используется настоящий код канала (createVkRunner) и
 * бота; Long Poll заменён очередью с той же семантикой: события
 * обрабатываются строго по одному (как в src/bot/vk/longpoll.ts).
 *
 *   npx tsx scripts/load/bot-load.mts --db=копия.sqlite --patients=50 --duration=60 \
 *     --think=3000-10000 --model-ms=0 --vk-ms=100 --out=r.json
 *
 * --model-ms — задержка заглушки модели (0 — бот без OpenAI, как без ключа;
 * >0 — модель «думает» столько миллисекунд и отвечает «недоступна», бот
 * продолжает по правилам). --vk-ms — задержка заглушки messages.send. Обе
 * задержки — ДОПУЩЕНИЯ о внешних сервисах, не замеры. Измеряется время от
 * поступления сообщения пациента до отправки ответа ботом.
 */
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import { createBot } from "@/bot/bot";
import type { ClinicSource } from "@/bot/clinic/types";
import { createConsentPort, createRequestPort } from "@/bot/consent";
import type { ConversationModel } from "@/bot/conversation/model";
import { RuleInterpreter } from "@/bot/dialog/rule-interpreter";
import { ClinicSchedule } from "@/bot/schedule/schedule";
import { MedicalCipher } from "@/bot/storage/medical-crypto";
import { SqliteStore } from "@/bot/storage/sqlite";
import { VkApi } from "@/bot/vk/api";
import { createVkRunner } from "@/bot/vk/runner";

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
const MODEL_MS = Number(arg("model-ms", "0"));
const VK_MS = Number(arg("vk-ms", "100"));
const FIRST_PEER = 9_100_001;
/** Ответ, не пришедший за это время, считается потерянным (тайм-аут). */
const REPLY_TIMEOUT_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

// --- Бот как в createDemoBot, но модель — заглушка с задержкой ---------------
const store = new SqliteStore(DB, {
  cipher: MedicalCipher.fromBase64(MedicalCipher.generateKey()),
});
const source: ClinicSource = () => store.clinic.load();
const schedule = new ClinicSchedule(source, store);
let modelCalls = 0;
const model: ConversationModel | undefined =
  MODEL_MS > 0
    ? {
        async decide() {
          modelCalls++;
          await sleep(MODEL_MS);
          return undefined; // «модель недоступна» — дальше правила
        },
      }
    : undefined;
const bot = createBot({
  clinic: source,
  schedule,
  sessions: store,
  interpreter: new RuleInterpreter(source),
  model,
  consents: createConsentPort(store.consents, schedule),
  requests: createRequestPort(store.requests),
  appAvailable: true,
  stats: store,
  // Виртуальные пациенты пишут чаще живых: лимит частоты не должен их отсекать.
  messagesPerMinute: 1000,
});

// --- Заглушка VK API: messages.send с задержкой, ответ — пациенту ---------
type Waiter = (labels: { label: string; payload?: string }[]) => void;
const waiting = new Map<number, Waiter>();
let sends = 0;
const fakeFetch = (async (_url: string, init?: RequestInit) => {
  const body = new URLSearchParams(String(init?.body ?? ""));
  await sleep(VK_MS);
  sends++;
  const peer = Number(body.get("peer_id"));
  const keyboard = body.get("keyboard");
  const labels: { label: string; payload?: string }[] = [];
  if (keyboard) {
    for (const row of JSON.parse(keyboard).buttons as {
      action: { label: string; payload?: string };
    }[][])
      for (const b of row)
        labels.push({ label: b.action.label, payload: b.action.payload });
  }
  // Время ответа — до первого сообщения бота этому пациенту.
  const w = waiting.get(peer);
  if (w) {
    waiting.delete(peer);
    w(labels);
  }
  return new Response(JSON.stringify({ response: 1 }), {
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

const api = new VkApi({
  token: "fake-token-not-real",
  version: "5.199",
  fetch: fakeFetch,
  baseUrl: "http://vk.invalid/method",
});
const allowed = new Set(
  Array.from({ length: PATIENTS }, (_, i) => FIRST_PEER + i),
);
const runner = createVkRunner({
  api,
  bot,
  store,
  allowedUserIds: allowed,
  miniApp: { appId: 51000001, groupId: 1 },
  log: () => {},
});

// --- Очередь событий: строго по одному, как Long Poll -----------------------
const queue: (() => Promise<void>)[] = [];
let maxQueue = 0;
let wake: (() => void) | undefined;
let running = true;
const handleMs: number[] = [];
async function consumer() {
  while (running || queue.length > 0) {
    const job = queue.shift();
    if (!job) {
      await new Promise<void>((r) => (wake = r));
      continue;
    }
    const t0 = performance.now();
    await job();
    if (measuring) handleMs.push(performance.now() - t0);
  }
}

let messageId = 1;
let measuring = false;
const latency: number[] = [];
let timeouts = 0;
let booked = 0;

function send(peer: number, text: string, payload?: string) {
  const id = messageId++;
  const t0 = performance.now();
  const reply = new Promise<{ label: string; payload?: string }[]>(
    (resolve) => {
      waiting.set(peer, resolve);
      setTimeout(() => {
        if (waiting.get(peer) === resolve) {
          waiting.delete(peer);
          if (measuring) timeouts++;
          resolve([]);
        }
      }, REPLY_TIMEOUT_MS);
    },
  );
  queue.push(() =>
    runner.onUpdate({
      type: "message_new",
      object: {
        message: { id, from_id: peer, peer_id: peer, text, payload },
        client_info: {
          keyboard: true,
          inline_keyboard: false,
          button_actions: ["text"],
        },
      },
    }),
  );
  maxQueue = Math.max(maxQueue, queue.length);
  wake?.();
  return reply.then((labels) => {
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
  try {
    await patientLoop(index, until);
  } catch (e) {
    if (e !== STOP) throw e;
  }
}

async function patientLoop(index: number, until: number) {
  const peer = FIRST_PEER + index;
  // После окончания замера пациент выходит на ближайшей паузе.
  const think = async () => {
    await sleep(THINK_MIN + Math.random() * Math.max(0, THINK_MAX - THINK_MIN));
    if (performance.now() >= until) throw STOP;
  };
  const press = (
    labels: { label: string; payload?: string }[],
    match: RegExp,
  ) => {
    const b = labels.find((l) => match.test(l.label));
    return b ? send(peer, b.label, b.payload) : send(peer, "В меню");
  };
  while (performance.now() < until) {
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
}

const cpu0 = process.cpuUsage();
const start = performance.now();
const until = start + WARMUP + DURATION;
setTimeout(() => {
  measuring = true;
}, WARMUP);
setTimeout(() => {
  measuring = false;
}, WARMUP + DURATION);
const loop = consumer();
let rssMax = 0;
const rssTimer = setInterval(() => {
  rssMax = Math.max(rssMax, process.memoryUsage().rss);
}, 1000);
await Promise.all(
  Array.from({ length: PATIENTS }, (_, i) =>
    sleep((i / PATIENTS) * (WARMUP / 2)).then(() => patient(i, until)),
  ),
);
running = false;
wake?.();
await loop;
clearInterval(rssTimer);
const cpu = process.cpuUsage(cpu0);
const seconds = (performance.now() - start) / 1000;

const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
const pct = (a: number[], p: number) =>
  a.length
    ? a[Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1)]
    : null;
const lat = sorted(latency);
const hm = sorted(handleMs);
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
check.close();
const out = {
  patients: PATIENTS,
  modelMs: MODEL_MS,
  vkMs: VK_MS,
  think: [THINK_MIN, THINK_MAX],
  messages: lat.length,
  messagesPerSec: lat.length / (DURATION / 1000),
  p50: pct(lat, 50),
  p95: pct(lat, 95),
  p99: pct(lat, 99),
  max: lat.at(-1) ?? null,
  timeouts,
  handleP50: pct(hm, 50),
  handleP95: pct(hm, 95),
  maxQueue,
  modelCalls,
  booked,
  doubleBookings: doubles,
  cpuPercent: ((cpu.user + cpu.system) / 1000 / (seconds * 1000)) * 100,
  rssMaxMB: rssMax / 1024 / 1024,
};
const file = arg("out");
if (file) writeFileSync(file, JSON.stringify(out, null, 1));
const f = (v: number | null) => (v == null ? "-" : v.toFixed(0));
console.log(
  `бот: пациентов=${PATIENTS} модель=${MODEL_MS}мс msg/s=${out.messagesPerSec.toFixed(2)} ` +
    `p50=${f(out.p50)} p95=${f(out.p95)} p99=${f(out.p99)} очередь≤${maxQueue} ` +
    `обработка p50=${f(out.handleP50)}мс cpu=${out.cpuPercent.toFixed(0)}% rss=${out.rssMaxMB.toFixed(0)}MB ` +
    `записей=${booked} двойных=${doubles} тайм-аутов=${timeouts}`,
);
