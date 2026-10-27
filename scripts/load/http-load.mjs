/**
 * Нагрузочный тест HTTP API «Демо-Мед»: VK Mini App (пациенты) и панель
 * (администраторы) на ЛОКАЛЬНОМ сервере с тестовой базой. Не запускать против
 * продакшена и действующих VPS. Отчёт — docs/load-test-report.md.
 *
 *   node scripts/load/http-load.mjs --base=http://127.0.0.1:3400 --launch=launch.json \
 *     --vus=50 --warmup=10 --duration=40 --think=1000-3000 --admins=2 --pids=123,124 --out=r.json
 *   node scripts/load/http-load.mjs ... --burst=50 --rounds=5   (гонка за один слот)
 *
 * Модель — закрытый цикл: каждый виртуальный пациент ждёт ответа и «думает»
 * между действиями, поэтому число одновременных пациентов и запросы в секунду
 * — разные величины (RPS измеряется). 409 «время занято» — ожидаемый отказ, а
 * не ошибка; ошибки — 5xx, обрывы и тайм-ауты (10 с); 429 считается отдельно.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : "1"];
  }),
);
const BASE = args.base ?? "http://127.0.0.1:3400";
const { launch } = JSON.parse(readFileSync(args.launch, "utf8"));
const VUS = Number(args.vus ?? 10);
const WARMUP = Number(args.warmup ?? 10) * 1000;
const DURATION = Number(args.duration ?? 40) * 1000;
const [THINK_MIN, THINK_MAX] = (args.think ?? "1000-3000")
  .split("-")
  .map(Number);
const ADMINS = Number(args.admins ?? 0);
const PIDS = (args.pids ?? "").split(",").filter(Boolean).map(Number);
const ADMIN_PASSWORD = process.env.LOAD_ADMIN_PASSWORD;
const TIMEOUT_MS = 10_000;
const DOCTORS = [
  "testova",
  "primerov",
  "demonstrova",
  "vymyslov",
  "obraztsova",
  "maketov",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (list) => list[Math.floor(Math.random() * list.length)];
/** Конец теста: пациенты выходят на ближайшей паузе. */
let deadline = Infinity;
const STOP = Symbol("stop");
const think = async () => {
  await sleep(THINK_MIN + Math.random() * Math.max(0, THINK_MAX - THINK_MIN));
  if (performance.now() >= deadline) throw STOP;
};

// --- Замеры ---------------------------------------------------------------
let measuring = false;
const stats = new Map(); // тип → { ms: [], codes: {} }
const bookings = { ok: 0, taken: 0, other: 0 };
function record(type, ms, status) {
  if (!measuring) return;
  let s = stats.get(type);
  if (!s) stats.set(type, (s = { ms: [], codes: {} }));
  s.ms.push(ms);
  s.codes[status] = (s.codes[status] ?? 0) + 1;
}

async function call(type, method, path, { headers = {}, body } = {}) {
  const t0 = performance.now();
  let status = 0;
  let json;
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...headers,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = res.status;
    json = await res.json().catch(() => undefined);
  } catch (error) {
    status = error?.name === "TimeoutError" ? "timeout" : "network";
  }
  record(type, performance.now() - t0, status);
  return { status, data: json?.data };
}

// --- Пациент в Mini App ----------------------------------------------------
async function patient(index, until) {
  try {
    await patientLoop(index, until);
  } catch (e) {
    if (e !== STOP) throw e;
  }
}

async function patientLoop(index, until) {
  const headers = { "x-vk-launch-params": launch[index] };
  const app = (type, method, path, body) =>
    call(type, method, `/api/miniapp/${path}`, { headers, body });
  while (performance.now() < until) {
    await app("clinic", "GET", "clinic");
    await think();
    const doctor = pick(DOCTORS);
    const days = (await app("days", "GET", `doctors/${doctor}/days`)).data;
    await think();
    if (Array.isArray(days) && days.length > 0) {
      const day = pick(days.slice(0, 5));
      const slots = (
        await app("slots", "GET", `doctors/${doctor}/slots?date=${day}`)
      ).data;
      await think();
      if (Array.isArray(slots) && slots.length > 0 && Math.random() < 0.6) {
        const r = await app("book", "POST", "bookings", {
          doctorId: doctor,
          date: day,
          time: pick(slots),
        });
        if (measuring) {
          if (r.status === 200) bookings.ok++;
          else if (r.status === 409) bookings.taken++;
          else bookings.other++;
        }
        await think();
      }
    }
    const mine = (await app("my", "GET", "bookings")).data;
    await think();
    const upcoming = mine?.upcoming ?? [];
    if (upcoming.length > 0) {
      const b = pick(upcoming);
      const roll = Math.random();
      if (roll < 0.3) {
        const slots = (
          await app(
            "slots",
            "GET",
            `doctors/${b.doctorId}/slots?date=${b.date}`,
          )
        ).data;
        await think();
        if (Array.isArray(slots) && slots.length > 0)
          await app("move", "PATCH", `bookings/${b.id}`, {
            action: "reschedule",
            doctorId: b.doctorId,
            date: b.date,
            time: pick(slots),
          });
        await think();
      } else if (roll < 0.6) {
        await app("cancel", "PATCH", `bookings/${b.id}`, { action: "cancel" });
        await think();
      }
    }
  }
}

// --- Администратор в панели --------------------------------------------------
async function adminLogin() {
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: {
      origin: BASE,
      "content-type": "application/json",
    },
    body: JSON.stringify({ login: "load-admin", password: ADMIN_PASSWORD }),
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (res.status !== 200 || !cookie)
    throw new Error(`вход в панель: ${res.status}`);
  return cookie;
}

async function admin(cookie, until) {
  const headers = { cookie };
  const panel = (type, path) =>
    call(type, "GET", `/api/admin/${path}`, { headers });
  const today = new Date().toISOString().slice(0, 10);
  const week = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  while (performance.now() < until) {
    if (performance.now() >= deadline) return;
    await panel("adm_dashboard", "dashboard");
    await sleep(3000 + Math.random() * 3000);
    await panel("adm_bookings", `bookings?from=${today}&to=${week}`);
    await sleep(3000 + Math.random() * 3000);
    const doctor = pick(DOCTORS);
    await panel("adm_schedule", `schedule/${doctor}`);
    await panel("adm_slots", `slots?doctorId=${doctor}&date=${today}`);
    await sleep(3000 + Math.random() * 3000);
  }
}

// --- Ресурсы сервера (по /proc) --------------------------------------------
function procSample() {
  let ticks = 0;
  let rss = 0;
  for (const pid of PIDS) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      ticks += Number(fields[11]) + Number(fields[12]); // utime + stime
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      rss += Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0) * 1024;
    } catch {
      // процесс завершился — пропускаем
    }
  }
  return { ticks, rss, at: performance.now() };
}

function startSampler() {
  const samples = [];
  let prev = procSample();
  const timer = setInterval(() => {
    const cur = procSample();
    const cpu =
      ((cur.ticks - prev.ticks) / 100 / ((cur.at - prev.at) / 1000)) * 100;
    samples.push({ cpu, rss: cur.rss });
    prev = cur;
  }, 1000);
  return () => {
    clearInterval(timer);
    return samples;
  };
}

const pct = (sorted, p) =>
  sorted.length === 0
    ? null
    : sorted[
        Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
      ];

function summarize(seconds, samples) {
  const all = [];
  const byType = {};
  let errors = 0;
  let limited = 0;
  let total = 0;
  for (const [type, s] of stats) {
    const sorted = [...s.ms].sort((a, b) => a - b);
    all.push(...sorted);
    const e = Object.entries(s.codes)
      .filter(([c]) => c === "timeout" || c === "network" || Number(c) >= 500)
      .reduce((n, [, v]) => n + v, 0);
    errors += e;
    limited += s.codes[429] ?? 0;
    total += sorted.length;
    byType[type] = {
      n: sorted.length,
      p50: pct(sorted, 50),
      p95: pct(sorted, 95),
      p99: pct(sorted, 99),
      codes: s.codes,
    };
  }
  all.sort((a, b) => a - b);
  const cpu = samples.map((s) => s.cpu);
  return {
    requests: total,
    rps: total / seconds,
    p50: pct(all, 50),
    p95: pct(all, 95),
    p99: pct(all, 99),
    max: all.at(-1) ?? null,
    errors,
    errorRate: total ? errors / total : 0,
    rateLimited: limited,
    bookings: { ...bookings },
    cpuAvg: cpu.length ? cpu.reduce((a, b) => a + b, 0) / cpu.length : null,
    cpuMax: cpu.length ? Math.max(...cpu) : null,
    rssMaxMB: samples.length
      ? Math.max(...samples.map((s) => s.rss)) / 1024 / 1024
      : null,
    generatorCpuMs: process.cpuUsage().user / 1000,
    byType,
  };
}

// --- Гонка за один слот ------------------------------------------------------
async function burst(size, rounds) {
  measuring = true;
  const results = [];
  for (let round = 0; round < rounds; round++) {
    const doctor = DOCTORS[round % DOCTORS.length];
    const headers0 = { "x-vk-launch-params": launch[0] };
    const days = (
      await call("burst_prep", "GET", `/api/miniapp/doctors/${doctor}/days`, {
        headers: headers0,
      })
    ).data;
    const day = days[days.length - 1];
    const slots = (
      await call(
        "burst_prep",
        "GET",
        `/api/miniapp/doctors/${doctor}/slots?date=${day}`,
        { headers: headers0 },
      )
    ).data;
    const time = slots[slots.length - 1];
    // Разные пациенты (с 1-го), все одновременно — на одно время.
    const codes = await Promise.all(
      Array.from({ length: size }, (_, i) =>
        call("burst_book", "POST", "/api/miniapp/bookings", {
          headers: { "x-vk-launch-params": launch[1 + i] },
          body: { doctorId: doctor, date: day, time },
        }).then((r) => r.status),
      ),
    );
    results.push({
      doctor,
      day,
      time,
      ok: codes.filter((c) => c === 200).length,
      taken: codes.filter((c) => c === 409).length,
      other: codes.filter((c) => c !== 200 && c !== 409),
    });
  }
  return results;
}

// --- Запуск ---------------------------------------------------------------
if (args.burst) {
  const results = await burst(Number(args.burst), Number(args.rounds ?? 5));
  const s = stats.get("burst_book");
  const sorted = [...(s?.ms ?? [])].sort((a, b) => a - b);
  const out = {
    mode: "burst",
    size: Number(args.burst),
    results,
    p50: pct(sorted, 50),
    p95: pct(sorted, 95),
    p99: pct(sorted, 99),
  };
  if (args.out) writeFileSync(args.out, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out));
} else {
  const cookies = [];
  for (let i = 0; i < ADMINS; i++) cookies.push(await adminLogin());
  const start = performance.now();
  const until = start + WARMUP + DURATION;
  deadline = until;
  let stop;
  let samples = [];
  setTimeout(() => {
    measuring = true;
    stop = startSampler();
  }, WARMUP);
  // Окно замера закрывается ровно по времени; ответы позже не учитываются.
  setTimeout(() => {
    measuring = false;
    samples = stop ? stop() : [];
  }, WARMUP + DURATION);
  await Promise.all([
    // Пациенты входят постепенно в течение первой половины прогрева.
    ...Array.from({ length: VUS }, (_, i) =>
      sleep((i / VUS) * (WARMUP / 2)).then(() => patient(i, until)),
    ),
    ...cookies.map((c) => admin(c, until)),
  ]);
  const seconds = DURATION / 1000;
  const summary = summarize(seconds, samples);
  const out = {
    mode: "mix",
    label: args.label ?? `vus=${VUS}`,
    vus: VUS,
    admins: ADMINS,
    think: [THINK_MIN, THINK_MAX],
    seconds,
    ...summary,
  };
  if (args.out) writeFileSync(args.out, JSON.stringify(out, null, 1));
  const f = (v) => (v == null ? "-" : v.toFixed(0));
  console.log(
    `${out.label}: rps=${out.rps.toFixed(1)} p50=${f(out.p50)} p95=${f(out.p95)} p99=${f(out.p99)} ` +
      `err=${(out.errorRate * 100).toFixed(2)}% 429=${out.rateLimited} cpu=${f(out.cpuAvg)}/${f(out.cpuMax)}% ` +
      `rss=${f(out.rssMaxMB)}MB book ok/taken=${out.bookings.ok}/${out.bookings.taken}`,
  );
}
