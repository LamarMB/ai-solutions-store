import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Probes } from "@/monitor/checks";
import { loadMonitorConfig, type MonitorConfig } from "@/monitor/config";
import { NotifyError, runMonitor, telegramNotifier } from "@/monitor/run";

/**
 * Мониторинг клиник (P0-9): недоступность бота и панели, резервные копии,
 * диск, память, сертификаты, защита от повторов, восстановление, изоляция
 * клиник и недоступность канала уведомлений. Всё — с подменёнными проверками.
 */

const ROOT = resolve(import.meta.dirname, "../..");
const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

const SECRET_TOKEN = "vk1.a.secret-community-token-0123456789";
const MEDICAL_KEY = "c2VjcmV0LW1lZGljYWwta2V5LXZhbHVlLTMyYnl0ZXM=";
const TG_TOKEN = "123456789:AAH-secret-telegram-token-abcdefghij12345";
const T0 = new Date("2026-10-29T10:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

type ClinicState = {
  bot: string;
  panel: string;
  lastPollAgoMin: number;
  http: number | "down";
  cert?: { days: number; matches?: boolean } | "down";
  backup?:
    { ok: boolean; agoHours: number; error?: string } | "none" | "unconfigured";
  memory?: number; // % лимита
};

function setup(
  ids: string[] = ["clinic-a", "clinic-b"],
  over: Record<string, string> = {},
) {
  const root = mkdtempSync(join(tmpdir(), "monitor-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const dirs = {
    clinics: join(root, "clinics"),
    backup: join(root, "backup"),
    data: join(root, "data"),
    nginx: join(root, "nginx"),
  };
  for (const d of Object.values(dirs)) mkdirSync(d);
  const clinics: Record<string, ClinicState> = {};
  ids.forEach((id, i) => {
    writeFileSync(
      join(dirs.clinics, `${id}.env`),
      `CLINIC_ID=${id}\nPANEL_PORT=${3101 + i}\nPANEL_DOMAIN=${id}.clinic.example\nVK_GROUP_TOKEN=${SECRET_TOKEN}\nMEDICAL_DATA_KEY=${MEDICAL_KEY}\n`,
    );
    mkdirSync(join(dirs.data, id));
    writeFileSync(join(dirs.backup, `${id}.env`), "BACKUP_KEY=x\n");
    writeFileSync(join(dirs.nginx, `demo-med-${id}.conf`), "server {}\n");
    clinics[id] = {
      bot: "active",
      panel: "active",
      lastPollAgoMin: 0,
      http: 200,
      cert: { days: 60 },
      backup: { ok: true, agoHours: 5 },
    };
  });
  const server = { diskFreePct: 50, memAvailablePct: 50 };
  let now = T0;
  const port = (id: string) => 3101 + ids.indexOf(id);
  const clinicOf = (unit: string) => unit.split("@")[1];

  const probes: Probes = {
    unitEnabled: async () => true,
    unitActive: async (unit) =>
      clinics[clinicOf(unit)][unit.includes("-bot@") ? "bot" : "panel"],
    unitMemory: async (unit) => ({
      current: ((clinics[clinicOf(unit)].memory ?? 20) / 100) * 400 * 1024 ** 2,
      max: 400 * 1024 ** 2,
    }),
    lastPoll: async (dbPath) => {
      const id = dbPath.split("/").at(-2)!;
      if (clinics[id].lastPollAgoMin < 0) throw new Error("database is locked");
      return new Date(
        now.getTime() - clinics[id].lastPollAgoMin * 60_000,
      ).toISOString();
    },
    httpStatus: async (url) => {
      const id = ids.find((x) => url.includes(`:${port(x)}/`))!;
      const h = clinics[id].http;
      if (h === "down") throw new Error("ECONNREFUSED");
      return h;
    },
    certificate: async (domain) => {
      const c = clinics[domain.split(".")[0]].cert;
      if (!c || c === "down") throw new Error("ECONNREFUSED");
      return {
        validTo: new Date(now.getTime() + c.days * 86_400_000),
        matches: c.matches ?? true,
      };
    },
    readText: (path) => {
      const status = /data\/([^/]+)\/backup-status\.json$/.exec(path);
      if (status) {
        const b = clinics[status[1]].backup;
        if (!b || typeof b === "string") return undefined;
        return JSON.stringify({
          ok: b.ok,
          at: new Date(now.getTime() - b.agoHours * 3_600_000).toISOString(),
          ...(b.error ? { error: b.error } : {}),
        });
      }
      return existsSync(path) ? readFileSync(path, "utf8") : undefined;
    },
    exists: (path) => {
      const backupConf = /backup\/([^/]+)\.env$/.exec(path);
      if (backupConf) return clinics[backupConf[1]]?.backup !== "unconfigured";
      return existsSync(path) || path === "/disk";
    },
    disk: () => ({
      device: 1,
      free: (server.diskFreePct / 100) * 100 * 1024 ** 3,
      total: 100 * 1024 ** 3,
    }),
    memory: () => ({
      available: (server.memAvailablePct / 100) * 8 * 1024 ** 3,
      total: 8 * 1024 ** 3,
    }),
  };

  const loaded = loadMonitorConfig(
    {
      MONITOR_CLINICS_DIR: dirs.clinics,
      MONITOR_BACKUP_CONF_DIR: dirs.backup,
      MONITOR_DATA_ROOT: dirs.data,
      MONITOR_NGINX_ENABLED_DIR: dirs.nginx,
      MONITOR_STATE_FILE: join(root, "state", "state.json"),
      MONITOR_DISK_PATHS: "/disk",
      MONITOR_DAILY_REPORT_HOUR: "-1",
      ...over,
    },
    "vps-test",
  );
  if (!loaded.ok) throw new Error(loaded.errors.join());
  const config: MonitorConfig = loaded.config;

  const sent: string[] = [];
  const logs: string[] = [];
  let channelDown = false;
  const notify = async (text: string) => {
    if (channelDown) throw new NotifyError("Telegram: нет связи");
    sent.push(text);
  };
  const run = async (minutes: number, { channel = true } = {}) => {
    now = at(minutes);
    return runMonitor(config, {
      probes,
      notify: channel ? notify : undefined,
      now,
      log: (m) => logs.push(m),
    });
  };
  return {
    root,
    config,
    probes,
    clinics,
    server,
    sent,
    logs,
    run,
    setChannelDown: (v: boolean) => (channelDown = v),
  };
}

describe("обнаружение сбоев", () => {
  it("всё исправно — проблем нет, сообщений нет", async () => {
    const t = setup();
    const r = await t.run(0);
    expect(r.findings.filter((f) => f.problem)).toEqual([]);
    expect(r.findings.map((f) => f.key)).toEqual(
      expect.arrayContaining([
        "clinic-a:bot",
        "clinic-a:panel",
        "clinic-a:backup",
        "clinic-a:tls",
        "clinic-b:bot",
        "server:disk:/disk",
        "server:memory",
      ]),
    );
    expect(t.sent).toEqual([]);
  });

  it("бот и панель недоступны — тревога после двух проверок подряд, только по своей клинике", async () => {
    const t = setup();
    t.clinics["clinic-a"].bot = "failed";
    t.clinics["clinic-a"].http = "down";
    await t.run(0);
    expect(t.sent).toEqual([]); // одна неудача — ещё не тревога (перезапуск, обновление)
    await t.run(5);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toBe(
      [
        "Демо-Мед · vps-test",
        "🔴 Проблемы (2):",
        "• clinic-a — Бот ВКонтакте: сервис не работает (failed)",
        "• clinic-a — Панель: не отвечает",
      ].join("\n"),
    );
  });

  it("бот запущен, но не получает события ВКонтакте; панель отвечает ошибкой", async () => {
    const t = setup(["clinic-a"], { MONITOR_FAIL_AFTER: "1" });
    t.clinics["clinic-a"].lastPollAgoMin = 12;
    t.clinics["clinic-a"].http = 502;
    await t.run(0);
    expect(t.sent[0]).toContain(
      "• clinic-a — Бот ВКонтакте: нет связи с ВКонтакте 12 мин",
    );
    expect(t.sent[0]).toContain(
      "• clinic-a — Панель: отвечает с ошибкой HTTP 502",
    );
  });

  it.each([
    [
      {
        ok: false,
        agoHours: 2,
        error: "отправка: хранилище (S3 …): PUT — HTTP 403 AccessDenied",
      },
      "последняя копия не создана: отправка: хранилище (S3 …): PUT — HTTP 403 AccessDenied",
    ],
    [{ ok: true, agoHours: 40 }, "последняя успешная копия 40 ч назад"],
    ["none", "копий ещё не было"],
    ["unconfigured", "резервное копирование не настроено"],
  ] as const)("резервная копия: %j", async (backup, problem) => {
    const t = setup(["clinic-a"], { MONITOR_FAIL_AFTER: "1" });
    t.clinics["clinic-a"].backup = backup as ClinicState["backup"];
    await t.run(0);
    expect(t.sent[0]).toContain(`• clinic-a — Резервная копия: ${problem}`);
  });

  it("нехватка диска и памяти сервера, сервис клиники у лимита памяти", async () => {
    const t = setup(["clinic-a"], { MONITOR_FAIL_AFTER: "1" });
    t.server.diskFreePct = 4;
    t.server.memAvailablePct = 6;
    t.clinics["clinic-a"].memory = 95;
    await t.run(0);
    expect(t.sent[0]).toContain("• сервер — Диск /disk: свободно 4% (4.0 ГБ)");
    expect(t.sent[0]).toContain(
      "• сервер — Память сервера: доступно 6% (0.5 ГБ из 8.0 ГБ)",
    );
    expect(t.sent[0]).toContain(
      "• clinic-a — Память бота: 95% лимита (380 из 400 МБ)",
    );
  });

  it.each([
    [{ days: 5 }, "сертификат clinic-a.clinic.example истекает через 5 дн."],
    [{ days: -1 }, "сертификат clinic-a.clinic.example истёк"],
    [
      { days: 60, matches: false },
      "сертификат выдан не для clinic-a.clinic.example",
    ],
    ["down", "https для clinic-a.clinic.example не отвечает"],
  ] as const)("сертификат: %j", async (cert, problem) => {
    const t = setup(["clinic-a"], { MONITOR_FAIL_AFTER: "1" });
    t.clinics["clinic-a"].cert = cert as ClinicState["cert"];
    await t.run(0);
    expect(t.sent[0]).toContain(`• clinic-a — Сертификат https: ${problem}`);
  });

  it("сообщения без секретов и содержимого настроек клиник", async () => {
    const t = setup(["clinic-a"], { MONITOR_FAIL_AFTER: "1" });
    Object.assign(t.clinics["clinic-a"], {
      bot: "failed",
      http: "down",
      cert: "down",
      backup: "none",
    });
    await t.run(0);
    const all = [...t.sent, ...t.logs].join("\n");
    for (const secret of [SECRET_TOKEN, MEDICAL_KEY])
      expect(all).not.toContain(secret);
  });
});

describe("защита от спама и восстановление", () => {
  it("неизменная проблема — одно сообщение; напоминание через сутки; восстановление — отдельным сообщением", async () => {
    const t = setup();
    t.clinics["clinic-b"].bot = "failed";
    for (let m = 0; m <= 60; m += 5) await t.run(m);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toContain(
      "🔴 Проблемы (1):\n• clinic-b — Бот ВКонтакте: сервис не работает (failed)",
    );

    await t.run(5 + 24 * 60);
    expect(t.sent).toHaveLength(2);
    expect(t.sent[1]).toContain(
      "🟠 Не исправлено (1):\n• clinic-b — Бот ВКонтакте: сервис не работает (failed) (уже 24 ч)",
    );

    t.clinics["clinic-b"].bot = "active";
    await t.run(10 + 24 * 60);
    expect(t.sent).toHaveLength(3);
    expect(t.sent[2]).toBe(
      "Демо-Мед · vps-test\n✅ Восстановлено (1):\n• clinic-b — Бот ВКонтакте: работает (сбой длился 24 ч)",
    );
    await t.run(15 + 24 * 60);
    expect(t.sent).toHaveLength(3);
  });

  it("кратковременный сбой (одна проверка) — без сообщений", async () => {
    const t = setup();
    t.clinics["clinic-a"].http = "down";
    await t.run(0);
    t.clinics["clinic-a"].http = 200;
    await t.run(5);
    expect(t.sent).toEqual([]);
  });

  it("изменения одного запуска — одним сообщением; новые проблемы при уже известной — только новые", async () => {
    const t = setup(["clinic-a", "clinic-b"], { MONITOR_FAIL_AFTER: "1" });
    t.clinics["clinic-a"].bot = "failed";
    await t.run(0);
    t.clinics["clinic-b"].http = "down";
    t.server.diskFreePct = 3;
    await t.run(5);
    expect(t.sent).toHaveLength(2);
    expect(t.sent[1]).not.toContain("clinic-a");
    expect(t.sent[1]).toContain("🔴 Проблемы (2):");
  });

  it("ежедневная сводка — раз в день", async () => {
    const t = setup(["clinic-a"], { MONITOR_DAILY_REPORT_HOUR: "0" });
    await t.run(0);
    await t.run(5);
    expect(t.sent).toEqual([
      "Демо-Мед · vps-test\nℹ️ Ежедневная сводка: клиник 1, открытых проблем 0. Мониторинг работает.",
    ]);
    await t.run(24 * 60);
    expect(t.sent).toHaveLength(2);
  });

  it("длинное сообщение обрезается до лимита Telegram", async () => {
    const ids = Array.from(
      { length: 120 },
      (_, i) => `clinic-${String(i).padStart(3, "0")}`,
    );
    const t = setup(ids, { MONITOR_FAIL_AFTER: "1" });
    for (const id of ids)
      Object.assign(t.clinics[id], { bot: "failed", http: "down" });
    await t.run(0);
    expect(t.sent[0].length).toBeLessThanOrEqual(4096);
    expect(t.sent[0]).toMatch(
      /…и ещё строк: \d+\. Подробно — journalctl -u demo-med-monitor$/,
    );
  });
});

describe("изоляция клиник", () => {
  it("сбой проверки одной клиники не скрывает другую и не ломает остальные проверки", async () => {
    const t = setup(["clinic-a", "clinic-b"], { MONITOR_FAIL_AFTER: "1" });
    t.clinics["clinic-a"].lastPollAgoMin = -1; // база заблокирована — проверка падает
    t.clinics["clinic-b"].http = "down";
    const r = await t.run(0);
    const problems = Object.fromEntries(
      r.findings.filter((f) => f.problem).map((f) => [f.key, f.problem]),
    );
    expect(problems).toEqual({
      "clinic-a:bot": "проверка не выполнена",
      "clinic-b:panel": "не отвечает",
    });
    expect(t.sent[0]).toContain(
      "• clinic-a — Бот ВКонтакте: проверка не выполнена",
    );
    expect(t.sent[0]).toContain("• clinic-b — Панель: не отвечает");
  });

  it("неполный файл настроек клиники — тревога по ней, другие проверяются", async () => {
    const t = setup(["clinic-a", "clinic-b"], { MONITOR_FAIL_AFTER: "1" });
    writeFileSync(
      join(t.config.clinicsDir, "clinic-a.env"),
      "CLINIC_ID=clinic-a\n",
    );
    const r = await t.run(0);
    expect(
      r.findings.find((f) => f.key === "clinic-a:config")?.problem,
    ).toMatch(/неполный/);
    expect(r.findings.some((f) => f.key === "clinic-b:bot")).toBe(true);
  });
});

describe("канал уведомлений недоступен", () => {
  it("тревога не теряется: повтор в следующий запуск, без дублей после доставки", async () => {
    const t = setup(["clinic-a"], { MONITOR_FAIL_AFTER: "1" });
    t.clinics["clinic-a"].bot = "failed";
    t.setChannelDown(true);
    await expect(t.run(0)).rejects.toThrow(NotifyError);
    await expect(t.run(5)).rejects.toThrow(NotifyError);
    expect(t.logs.join("\n")).toContain(
      "уведомление не отправлено: Telegram: нет связи; повтор при следующей проверке",
    );
    expect(t.logs.join("\n")).toContain(
      "clinic-a — Бот ВКонтакте: сервис не работает",
    );
    t.setChannelDown(false);
    await t.run(10);
    await t.run(15);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toContain("clinic-a — Бот ВКонтакте");
  });

  it("Telegram: токен не попадает в ошибки; HTTP-ошибка и нет связи", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const ok = telegramNotifier(
      {
        token: TG_TOKEN,
        chatId: "-100123",
        apiBase: "https://api.telegram.org",
      },
      (async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    );
    await ok("проверка");
    expect(calls).toEqual([
      {
        url: `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
        body: {
          chat_id: "-100123",
          text: "проверка",
          disable_web_page_preview: true,
        },
      },
    ]);
    const denied = telegramNotifier(
      { token: TG_TOKEN, chatId: "1", apiBase: "https://api.telegram.org" },
      (async () =>
        Response.json(
          { ok: false, description: `Unauthorized for ${TG_TOKEN}` },
          { status: 401 },
        )) as unknown as typeof fetch,
    );
    const err = await denied("x").catch((e: Error) => e.message);
    expect(err).toBe("Telegram: HTTP 401 — Unauthorized for ***");
    const offline = telegramNotifier(
      { token: TG_TOKEN, chatId: "1", apiBase: "https://api.telegram.org" },
      (async () => {
        throw new Error(
          `connect failed https://api.telegram.org/bot${TG_TOKEN}`,
        );
      }) as typeof fetch,
    );
    expect(await offline("x").catch((e: Error) => e.message)).toBe(
      "Telegram: нет связи",
    );
  });

  it("без Telegram — сообщения в журнале, с той же защитой от повторов", async () => {
    const t = setup(["clinic-a"], { MONITOR_FAIL_AFTER: "1" });
    t.clinics["clinic-a"].http = "down";
    for (const minutes of [0, 5, 10]) await t.run(minutes, { channel: false });
    const messages = t.logs.filter((l) => l.startsWith("Демо-Мед · vps-test"));
    expect(messages).toEqual([
      "Демо-Мед · vps-test | 🔴 Проблемы (1): | • clinic-a — Панель: не отвечает",
    ]);
  });
});

describe("настройки и шаблоны", () => {
  it("ошибки настроек — по имени, без значений", () => {
    const r = loadMonitorConfig({
      MONITOR_TELEGRAM_BOT_TOKEN: "not-a-token",
      MONITOR_TELEGRAM_CHAT_ID: "abc",
      MONITOR_FAIL_AFTER: "0",
      MONITOR_DISK_MIN_FREE_PERCENT: "150",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.split(":")[0])).toEqual([
        "MONITOR_TELEGRAM_BOT_TOKEN",
        "MONITOR_TELEGRAM_CHAT_ID",
        "MONITOR_DISK_MIN_FREE_PERCENT",
        "MONITOR_FAIL_AFTER",
      ]);
      expect(r.errors.join()).not.toContain("not-a-token");
    }
    const ok = loadMonitorConfig({
      MONITOR_TELEGRAM_BOT_TOKEN: TG_TOKEN,
      MONITOR_TELEGRAM_CHAT_ID: "-1001234567890",
    });
    expect(ok.ok && ok.config.telegram?.chatId).toBe("-1001234567890");
  });

  it("сервис: чтение данных клиник без записи, своё состояние; таймер — каждые 5 минут", () => {
    const unit = readFileSync(
      join(ROOT, "deploy/systemd/demo-med-monitor.service"),
      "utf8",
    );
    for (const line of [
      "CapabilityBoundingSet=CAP_DAC_READ_SEARCH",
      "ProtectSystem=strict",
      "NoNewPrivileges=yes",
      "StateDirectory=demo-med-monitor",
      "EnvironmentFile=-/etc/demo-med/monitor.env",
      "SyslogIdentifier=demo-med-monitor",
    ])
      expect(unit).toContain(line);
    expect(unit).not.toMatch(/ReadWritePaths=.*demo-med\//);
    const timer = readFileSync(
      join(ROOT, "deploy/systemd/demo-med-monitor.timer"),
      "utf8",
    );
    expect(timer).toContain("OnUnitActiveSec=5min");
    const template = readFileSync(
      join(ROOT, "deploy/monitor.env.example"),
      "utf8",
    );
    expect(template).toMatch(/^MONITOR_TELEGRAM_BOT_TOKEN=$/m);
  });
});
