/**
 * Сквозной сценарий `npm run e2e:bot-booking` (docs/vk-bot-run.md, «Сквозная
 * проверка»): пациент пишет VK-боту → выбирает направление и врача → получает
 * время → подтверждает запись → запись в базе → владелец видит её в панели →
 * пациент отменяет запись через бота → статус «Отменена», слот снова свободен.
 *
 * ВКонтакте ИМИТИРУЕТСЯ (scripts/e2e/fake-vk.mts): бот собран как в
 * scripts/vk-bot.mts (createDemoBot → createVkRunner → runLongPoll → VkApi), но
 * fetch подменён — запросы в настоящий ВКонтакте невозможны. Панель — отдельный
 * `next start` на той же временной базе, как на сервере. Временная база,
 * вымышленные клиника и пациенты, ключи на один запуск; очистка — при любом
 * исходе (scripts/e2e/harness.mjs). Отчёт — .data/e2e/bot-booking-<время>/.
 */
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { createDemoBot } from "@/bot";
import { KeyedQueue } from "@/bot/concurrency";
import { ClinicSchedule } from "@/bot/schedule/schedule";
import { MedicalCipher } from "@/bot/storage/medical-crypto";
import { VkApi } from "@/bot/vk/api";
import { runLongPoll } from "@/bot/vk/longpoll";
import { createVkRunner, peerOf } from "@/bot/vk/runner";
import { FAKE_VK_API, FakeVk, type TranscriptEntry } from "./fake-vk.mjs";
import {
  createSession,
  launchOptions,
  loadChromium,
  ROOT,
  secret,
} from "./harness.mjs";

const PATIENT = 900100;
const OTHER = 900777;
const GROUP_ID = 230000001; // вымышленное сообщество

type Step = {
  id: string;
  title: string;
  ok: boolean;
  ms: number;
  error?: string;
  [key: string]: unknown;
};
const report = {
  ok: false,
  vk: "ИМИТАЦИЯ: ВКонтакте заменён FakeVk (scripts/e2e/fake-vk.mts) внутри процесса; в настоящий ВКонтакте ничего не отправлялось",
  steps: [] as Step[],
  booking: undefined as
    { id: number; doctorId: string; date: string; time: string } | undefined,
  vkCalls: {} as Record<string, number>,
  blockedRequests: [] as string[],
  consoleErrors: [] as string[],
  failedRequests: [] as string[],
  botLog: [] as string[],
};

const check = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(msg);
};
const escape = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
function transcriptHtml(entries: TranscriptEntry[]) {
  const rows = entries
    .map((e) =>
      e.from === "patient"
        ? `<div class="m p"><b>Пациент${e.via === "button" ? " (кнопка)" : ""}</b>${escape(e.text)}</div>`
        : `<div class="m b"><b>Бот</b>${escape(e.text)}${e.buttons.length ? `<div class="k">${e.buttons.map((l) => `<span>${escape(l)}</span>`).join("")}</div>` : ""}${e.keyboard ? `<div class="pk">⌨ Клавиатура у поля ввода: ${e.keyboard.map((l) => `<span>${escape(l)}</span>`).join("")}</div>` : ""}</div>`,
    )
    .join("");
  return `<!doctype html><meta charset="utf-8"><style>
body{font:14px/1.4 system-ui,sans-serif;background:#edeef0;margin:0;padding:16px;max-width:560px}
h1{font-size:15px;background:#fff3cd;padding:8px 12px;border-radius:8px}
.m{white-space:pre-wrap;padding:8px 12px;border-radius:12px;margin:8px 0;max-width:85%}
.m b{display:block;font-size:12px;opacity:.6}.p{background:#cce4ff;margin-left:auto}.b{background:#fff}
.pk{margin-top:6px;font-size:12px;color:#2a5885}.pk span{display:inline-block;background:#e5ebf1;border-radius:8px;padding:2px 8px;margin:4px 4px 0 0}
.k span{display:inline-block;border:1px solid #c5d0db;border-radius:8px;padding:2px 8px;margin:4px 4px 0 0;font-size:12px}
</style><h1>Переписка с ботом — ВКонтакте ИМИТИРОВАН (FakeVk), вымышленные данные</h1>${rows}`;
}

const session = createSession("bot-booking");
// Сеть процесса — только локальная панель и имитация ВКонтакте.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  if (url.hostname !== "127.0.0.1") {
    report.blockedRequests.push(url.origin);
    throw new Error("E2E: внешние запросы запрещены");
  }
  return realFetch(input, init);
}) as typeof fetch;

const vk = new FakeVk(GROUP_ID);
let browser: { close(): Promise<void> } | undefined;
let shotN = 0;

try {
  session.checkBuild();
  const chromium = loadChromium();
  const dbPath = join(session.tmp, "bot.sqlite");
  const medicalKey = secret(32, "base64");
  const owner = { login: "e2e-owner", password: secret(18) };

  // Та же подготовка базы, что у e2e:patient-flow: владелец и запись другого пациента.
  const seed = await session.runTsx(
    join(ROOT, "scripts", "e2e", "patient-flow-seed.mts"),
    {
      BOT_DB_PATH: dbPath,
      E2E_TMP_ROOT: session.tmp,
      MEDICAL_DATA_KEY: medicalKey,
      E2E_OWNER_LOGIN: owner.login,
      E2E_OWNER_PASSWORD: owner.password,
      E2E_OTHER_VK_ID: String(OTHER),
    },
  );
  const { otherBookingId } = JSON.parse(seed.trim().split("\n").at(-1)!) as {
    otherBookingId: number;
  };

  const base = await session.startServer({
    BOT_DB_PATH: dbPath,
    VK_MINIAPP_ID: "",
    VK_MINIAPP_SECRET: "",
  });

  // Бот — как в scripts/vk-bot.mts, только без настоящего ВКонтакте.
  const log = (message: string) => report.botLog.push(message);
  const { bot, store } = createDemoBot({
    dbPath,
    cipher: MedicalCipher.fromBase64(medicalKey),
    miniApp: false,
    demo: true,
    log,
  });
  const api = new VkApi({
    token: "e2e-fake-token",
    version: "5.199",
    fetch: vk.fetch,
    baseUrl: FAKE_VK_API,
    retries: 0,
  });
  const runner = createVkRunner({
    api,
    bot,
    store,
    allowedUserIds: new Set([PATIENT]),
    demo: true,
    log,
  });
  const queue = new KeyedQueue<number>({
    concurrency: 4,
    limit: 100,
    onError: (e) => log(`обработка события: ${(e as Error)?.name}`),
  });
  const controller = new AbortController();
  const loop = runLongPoll(
    {
      api,
      groupId: GROUP_ID,
      fetch: vk.fetch,
      onUpdate: runner.onUpdate,
      dispatch: (u) => queue.push(peerOf(u), () => runner.onUpdate(u)),
      waitForCapacity: (s) => queue.waitForCapacity(s),
      log,
    },
    controller.signal,
  );
  session.onCleanup(async () => {
    controller.abort();
    await loop.catch(() => {});
    await queue.drain(5000);
    store.close();
  });

  const schedule = new ClinicSchedule(() => store.clinic.load(), store);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  session.onCleanup(() => db.close());
  const row = (id: number) =>
    db
      .prepare(
        "SELECT peer_id, doctor_id, date, time, status, source, cancelled_at FROM bookings WHERE id = ?",
      )
      .get(id) as Record<string, string | number | null> | undefined;

  const pw = await chromium.launch(launchOptions());
  browser = pw;
  const admin = await (
    await pw.newContext({
      viewport: { width: 1280, height: 900 },
      locale: "ru-RU",
    })
  ).newPage();
  admin.on(
    "console",
    (m: { type(): string; text(): string }) =>
      m.type() === "error" && report.consoleErrors.push(m.text()),
  );
  admin.on("pageerror", (e: Error) => report.consoleErrors.push(e.message));
  admin.on(
    "response",
    (r: {
      status(): number;
      url(): string;
      request(): { method(): string };
    }) => {
      if (r.status() >= 400)
        report.failedRequests.push(
          `${r.request().method()} ${new URL(r.url()).pathname} → ${r.status()}`,
        );
    },
  );
  const shot = async (name: string) => {
    const file = `${String(++shotN).padStart(2, "0")}-${name}.png`;
    await admin.screenshot({ path: join(session.shots, file), fullPage: true });
    return file;
  };
  const chatShot = async (name: string) => {
    const page = await pw.newPage({ viewport: { width: 600, height: 800 } });
    await page.setContent(transcriptHtml(vk.transcript));
    const file = `${String(++shotN).padStart(2, "0")}-${name}.png`;
    await page.screenshot({ path: join(session.shots, file), fullPage: true });
    await page.close();
    return file;
  };
  async function step(
    id: string,
    title: string,
    fn: () => Promise<Record<string, unknown> | void>,
  ) {
    const started = Date.now();
    try {
      const details = (await fn()) ?? {};
      report.steps.push({
        id,
        title,
        ok: true,
        ms: Date.now() - started,
        ...details,
      });
      console.log(`PASS ${id} ${title}`);
    } catch (e) {
      const error = String((e as Error)?.message ?? e).slice(0, 800);
      report.steps.push({
        id,
        title,
        ok: false,
        ms: Date.now() - started,
        error,
      });
      console.log(`FAIL ${id} ${title}: ${error.slice(0, 300)}`);
      await shot(`FAIL-${id}-panel`).catch(() => {});
      await chatShot(`FAIL-${id}-chat`).catch(() => {});
      throw e;
    }
  }
  /** Нажатие кнопки и ожидание ответа бота. */
  const press = async (label: string | RegExp, expect: RegExp) => {
    const after = vk.lastN;
    vk.press(PATIENT, label);
    return vk.reply(PATIENT, expect, after);
  };
  const buttons = (m: { buttons: { label: string; payload?: string }[] }) =>
    m.buttons.map((b) => ({
      label: b.label,
      action: JSON.parse(b.payload ?? "{}") as Record<string, string>,
    }));

  let booking!: { id: number; doctorId: string; date: string; time: string };
  let lastMessage!: Awaited<ReturnType<typeof press>>;

  await step("B1", "Пациент пишет боту (ВКонтакте имитирован)", async () => {
    const after = vk.lastN;
    vk.write(PATIENT, "Начать", { command: "start" });
    lastMessage = await vk.reply(PATIENT, /Здравствуйте/, after);
    // Главное меню — постоянная клавиатура у поля ввода, не кнопки под сообщением.
    check(
      lastMessage.setsKeyboard && lastMessage.buttons.length === 0,
      "главное меню пришло не постоянной клавиатурой",
    );
    check(
      ["Записаться на приём", "Мои записи", "Администратор"].every((l) =>
        vk.keyboardLabels(PATIENT).includes(l),
      ),
      `у поля ввода: ${vk.keyboardLabels(PATIENT).join(" | ")}`,
    );
  });

  await step("B2", "Выбор направления и врача", async () => {
    await press("Записаться на приём", /Выберите направление/);
    await press("Терапевт", /Анна Тестова/);
    lastMessage = await press("Анна Тестова", /Выберите день/);
  });

  await step("B3", "Бот показывает доступное время", async () => {
    const day = buttons(lastMessage).find((b) => b.action.a === "day");
    check(day, "нет кнопок дней");
    lastMessage = await press(day!.label, /Выберите время/);
    const times = buttons(lastMessage).filter((b) => b.action.a === "time");
    check(times.length > 0, "нет кнопок времени");
    const date = day!.action.dt;
    const free = schedule.listFreeSlots("testova", date);
    for (const t of times)
      check(
        free.includes(t.action.t),
        `время ${t.action.t} не свободно в расписании`,
      );
    booking = { id: 0, doctorId: "testova", date, time: times[0].action.t };
    return { date, offered: times.map((t) => t.action.t) };
  });

  await step("B4", "Пациент подтверждает запись", async () => {
    await press(booking.time, /Проверьте запись/);
    lastMessage = await press("Подтвердить", /Запись №\d+ подтверждена/);
    booking.id = Number(/Запись №(\d+)/.exec(lastMessage.text)![1]);
    report.booking = booking;
    return { bookingId: booking.id, shots: [await chatShot("chat-booked")] };
  });

  await step("B5", "Запись сохранена в тестовой базе, слот занят", async () => {
    const r = row(booking.id);
    check(
      r &&
        r.peer_id === PATIENT &&
        r.doctor_id === "testova" &&
        r.date === booking.date &&
        r.time === booking.time &&
        r.status === "confirmed" &&
        r.source === "vk",
      `запись в базе: ${JSON.stringify(r)}`,
    );
    check(
      !schedule.listFreeSlots("testova", booking.date).includes(booking.time),
      "слот остался свободным после записи",
    );
  });

  await step("B6", "Владелец видит запись в панели", async () => {
    await admin.goto(`${base}/admin/login`);
    await admin.getByLabel("Логин").fill(owner.login);
    await admin.getByLabel("Пароль").fill(owner.password);
    await admin.getByRole("button", { name: /Войти/ }).click();
    await admin.waitForURL((u: URL) => !u.pathname.startsWith("/admin/login"));
    await admin.goto(`${base}/admin/bookings`);
    const item = admin.getByRole("button", {
      name: new RegExp(`№${booking.id} ·`),
    });
    await item.waitFor();
    const text = (await item.innerText()).replace(/\s+/g, " ");
    check(text.includes(booking.time), `в строке нет времени: ${text}`);
    check(!text.includes(String(PATIENT)), `полный VK ID в строке: ${text}`);
    const s1 = await shot("panel-bookings");
    await item.click();
    const dialog = admin.getByRole("dialog");
    await dialog.waitFor();
    const details = (await dialog.innerText()).replace(/\s+/g, " ");
    check(
      details.includes("Бот ВКонтакте"),
      `источник: ${details.slice(0, 300)}`,
    );
    check(details.includes("Подтверждена"), "статус не «Подтверждена»");
    const s2 = await shot("panel-booking-details");
    await admin.keyboard.press("Escape");
    return { row: text, shots: [s1, s2] };
  });

  await step("B7", "Пациент отменяет запись через бота", async () => {
    await press("Мои записи", new RegExp(`№${booking.id}:`));
    await press(
      `Отменить №${booking.id}`,
      new RegExp(`Отменить запись №${booking.id}\\?`),
    );
    lastMessage = await press(
      "Да, отменить",
      new RegExp(`Запись №${booking.id} отменена`),
    );
    return { shots: [await chatShot("chat-cancelled")] };
  });

  await step("B8", "Статус «Отменена», слот снова свободен", async () => {
    const r = row(booking.id);
    check(
      r?.status === "cancelled" && r.cancelled_at,
      `запись после отмены: ${JSON.stringify(r)}`,
    );
    check(
      schedule.listFreeSlots("testova", booking.date).includes(booking.time),
      `слот ${booking.date} ${booking.time} не освободился`,
    );
    // Пациент снова видит это время в боте — на дне записи, а не на первом дне.
    await press("Записаться на приём", /Выберите направление/);
    await press("Терапевт", /Анна Тестова/);
    lastMessage = await press("Анна Тестова", /Выберите день/);
    const day = buttons(lastMessage).find(
      (b) => b.action.a === "day" && b.action.dt === booking.date,
    );
    check(day, `дня ${booking.date} нет среди дней в боте`);
    lastMessage = await press(day!.label, /Выберите время/);
    check(
      buttons(lastMessage).some(
        (b) => b.action.a === "time" && b.action.t === booking.time,
      ),
      `время ${booking.time} не предлагается ботом`,
    );
    await admin.goto(`${base}/admin/bookings`);
    const item = admin.getByRole("button", {
      name: new RegExp(`№${booking.id} ·`),
    });
    await item.waitFor();
    const text = (await item.innerText()).replace(/\s+/g, " ");
    check(text.includes("Отменена"), `в панели статус: ${text}`);
    const other = row(otherBookingId);
    check(other?.status === "confirmed", "запись другого пациента изменилась");
    return {
      shots: [await shot("panel-cancelled"), await chatShot("chat-slot-free")],
    };
  });

  await step(
    "B9",
    "Чистота: ответы на нажатия, нет внешних запросов, ошибок и VK ID в журнале",
    async () => {
      const callbacks = vk.callbacks;
      report.vkCalls = { ...vk.calls };
      const menuUnderMessage = vk.sent.filter(
        (m) =>
          m.buttons.some((b) => b.label === "Мои записи") &&
          m.buttons.some((b) => b.label === "Администратор"),
      );
      check(
        menuUnderMessage.length === 0,
        `главное меню под сообщениями: ${menuUnderMessage.length}`,
      );
      check(
        vk.calls["messages.sendMessageEventAnswer"] === callbacks,
        `ответов на нажатия ${vk.calls["messages.sendMessageEventAnswer"]} из ${callbacks}`,
      );
      report.blockedRequests.push(...vk.blockedUrls);
      check(
        report.blockedRequests.length === 0,
        `внешние запросы: ${report.blockedRequests.join(", ")}`,
      );
      check(
        report.consoleErrors.length === 0,
        `ошибки консоли: ${report.consoleErrors.join(" | ")}`,
      );
      check(
        report.failedRequests.length === 0,
        `ответы с ошибкой: ${report.failedRequests.join(" | ")}`,
      );
      const logText = report.botLog.join("\n");
      check(!logText.includes(String(PATIENT)), "полный VK ID в журнале бота");
      check(
        !/Анна Тестова|Терапевт/.test(logText),
        "текст сообщений в журнале бота",
      );
    },
  );

  report.ok = true;
} catch (e) {
  if (!report.steps.some((s) => !s.ok))
    report.steps.push({
      id: "setup",
      title: "Подготовка окружения",
      ok: false,
      ms: 0,
      error: String((e as Error)?.stack ?? e).slice(0, 2000),
    });
  if (report.steps.at(-1)?.id === "setup")
    console.error(`Ошибка подготовки: ${(e as Error)?.message ?? e}`);
} finally {
  report.vkCalls = { ...vk.calls };
  session.saveArtifacts(report.ok, report, {
    "transcript.html": transcriptHtml(vk.transcript),
  });
  await browser?.close().catch(() => {});
  await session.cleanup();
}

console.log(
  `${report.ok ? "E2E bot-booking: пройден" : "E2E bot-booking: ОШИБКА"} (ВКонтакте имитирован). Отчёт: ${session.artifacts}`,
);
process.exit(report.ok ? 0 : 1);
