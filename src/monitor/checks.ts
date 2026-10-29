import { execFile } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statfsSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { checkServerIdentity, connect, type PeerCertificate } from "node:tls";
import { parseEnv } from "node:util";
import type { MonitorConfig } from "@/monitor/config";

/**
 * Проверки экземпляров клиник и сервера. Каждая проверка — отдельный
 * результат со своим ключом: сбой одной клиники или одной проверки не скрывает
 * остальные. В тексте — только идентификатор клиники, название проверки и
 * причина: без данных пациентов, разговоров и секретов.
 */

export type Finding = {
  /** Стабильный ключ: «clinic-a:bot», «server:disk:/». */
  key: string;
  /** Клиника или «server». */
  scope: string;
  title: string;
  /** Причина; нет — проверка пройдена. */
  problem?: string;
};

/** Внешний мир для проверок — подменяется в тестах. */
export type Probes = {
  /** systemctl is-enabled / is-active. */
  unitEnabled(unit: string): Promise<boolean>;
  unitActive(unit: string): Promise<string>;
  /** Память сервиса systemd, байт (max — лимит MemoryMax, если задан). */
  unitMemory(unit: string): Promise<{ current?: number; max?: number }>;
  /** Отметка бота «получил события ВКонтакте» из базы клиники (только чтение). */
  lastPoll(dbPath: string): Promise<string | undefined>;
  /** HTTP-код ответа или исключение. */
  httpStatus(url: string, timeoutMs: number): Promise<number>;
  /** Сертификат, который nginx отдаёт для домена (подключение к 127.0.0.1:443). */
  certificate(
    domain: string,
    timeoutMs: number,
  ): Promise<{ validTo: Date; matches: boolean }>;
  readText(path: string): string | undefined;
  exists(path: string): boolean;
  disk(path: string): { device: number; free: number; total: number };
  memory(): { available: number; total: number };
};

export type Clinic = { id: string; port: number; domain: string };

const minutes = (ms: number) => Math.round(ms / 60_000);
const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} ГБ`;

/** Клиники сервера — из файлов настроек; секреты не читаются в результат. */
export function discoverClinics(
  dir: string,
  readText: (p: string) => string | undefined,
): { clinics: Clinic[]; findings: Finding[] } {
  const clinics: Clinic[] = [];
  const findings: Finding[] = [];
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".env"));
  } catch {
    findings.push({
      key: "server:clinics",
      scope: "server",
      title: "Список клиник",
      problem: "каталог настроек клиник не читается",
    });
  }
  for (const file of files.sort()) {
    const name = file.slice(0, -4);
    try {
      const env = parseEnv(readText(join(dir, file)) ?? "");
      const port = Number(env.PANEL_PORT);
      if (
        env.CLINIC_ID !== name ||
        !Number.isInteger(port) ||
        !env.PANEL_DOMAIN
      )
        throw new Error();
      clinics.push({ id: name, port, domain: env.PANEL_DOMAIN.toLowerCase() });
    } catch {
      findings.push({
        key: `${name}:config`,
        scope: name,
        title: "Настройки",
        problem:
          "файл настроек не читается или неполный (CLINIC_ID, PANEL_PORT, PANEL_DOMAIN)",
      });
    }
  }
  return { clinics, findings };
}

/** Проверка с защитой: исключение — «проверка не выполнена» только для неё. */
async function guarded(
  base: Omit<Finding, "problem">,
  fn: () => Promise<string | undefined>,
): Promise<Finding> {
  try {
    return { ...base, problem: await fn() };
  } catch {
    return { ...base, problem: "проверка не выполнена" };
  }
}

export async function checkClinic(
  clinic: Clinic,
  config: MonitorConfig,
  probes: Probes,
  now: Date,
): Promise<Finding[]> {
  const id = clinic.id;
  const bot = `demo-med-bot@${id}`;
  const panel = `demo-med-panel@${id}`;
  const dbPath = join(config.dataRoot, id, "bot.sqlite");
  const checks: Promise<Finding | undefined>[] = [];

  // Бот: сервис запущен и получает события ВКонтакте (отметка last_poll_at).
  checks.push(
    (async () => {
      if (!(await probes.unitEnabled(bot))) return undefined; // ещё не включён по чек-листу
      return guarded(
        { key: `${id}:bot`, scope: id, title: "Бот ВКонтакте" },
        async () => {
          const state = await probes.unitActive(bot);
          if (state !== "active") return `сервис не работает (${state})`;
          const last = await probes.lastPoll(dbPath);
          if (!last) return "нет отметки о связи с ВКонтакте";
          const age = now.getTime() - Date.parse(last);
          if (age > config.botStaleMinutes * 60_000)
            return `нет связи с ВКонтакте ${minutes(age)} мин`;
          return undefined;
        },
      );
    })(),
  );

  // Панель: сервис запущен и отвечает на 127.0.0.1.
  checks.push(
    (async () => {
      if (!(await probes.unitEnabled(panel))) return undefined;
      return guarded(
        { key: `${id}:panel`, scope: id, title: "Панель" },
        async () => {
          const state = await probes.unitActive(panel);
          if (state !== "active") return `сервис не работает (${state})`;
          let status: number;
          try {
            status = await probes.httpStatus(
              `http://127.0.0.1:${clinic.port}/admin/login`,
              config.panelTimeoutMs,
            );
          } catch {
            return "не отвечает";
          }
          return status === 200
            ? undefined
            : `отвечает с ошибкой HTTP ${status}`;
        },
      );
    })(),
  );

  // Память сервисов клиники относительно их лимита MemoryMax.
  for (const [unit, title] of [
    [bot, "Память бота"],
    [panel, "Память панели"],
  ] as const) {
    checks.push(
      (async () => {
        if (!(await probes.unitEnabled(unit))) return undefined;
        return guarded(
          {
            key: `${id}:${unit.split("@")[0].slice(9)}-memory`,
            scope: id,
            title,
          },
          async () => {
            const { current, max } = await probes.unitMemory(unit);
            if (!current || !max) return undefined;
            const pct = Math.round((current / max) * 100);
            return pct >= config.unitMemoryMaxPercent
              ? `${pct}% лимита (${Math.round(current / 1024 ** 2)} из ${Math.round(max / 1024 ** 2)} МБ)`
              : undefined;
          },
        );
      })(),
    );
  }

  // Резервные копии: настроены, последняя успешна и свежая (backup-status.json, P0-8).
  checks.push(
    guarded(
      { key: `${id}:backup`, scope: id, title: "Резервная копия" },
      async () => {
        const configured = probes.exists(
          join(config.backupConfDir, `${id}.env`),
        );
        if (!configured)
          return config.requireBackup
            ? "резервное копирование не настроено"
            : undefined;
        const raw = probes.readText(
          join(config.dataRoot, id, "backup-status.json"),
        );
        if (!raw) return "копий ещё не было";
        const status = JSON.parse(raw) as {
          ok?: boolean;
          at?: string;
          error?: string;
        };
        const age = now.getTime() - Date.parse(status.at ?? "");
        if (status.ok !== true)
          return `последняя копия не создана: ${String(status.error ?? "причина неизвестна").slice(0, 300)}`;
        if (!(age <= config.backupMaxAgeHours * 3_600_000))
          return `последняя успешная копия ${Math.round(age / 3_600_000)} ч назад`;
        return undefined;
      },
    ),
  );

  // Сертификат https — если nginx клиники настроен.
  checks.push(
    (async () => {
      if (!probes.exists(join(config.nginxEnabledDir, `demo-med-${id}.conf`)))
        return undefined;
      return guarded(
        { key: `${id}:tls`, scope: id, title: "Сертификат https" },
        async () => {
          let cert: { validTo: Date; matches: boolean };
          try {
            cert = await probes.certificate(
              clinic.domain,
              config.panelTimeoutMs,
            );
          } catch {
            return `https для ${clinic.domain} не отвечает`;
          }
          if (!cert.matches) return `сертификат выдан не для ${clinic.domain}`;
          const days = Math.floor(
            (cert.validTo.getTime() - now.getTime()) / 86_400_000,
          );
          if (days < 0) return `сертификат ${clinic.domain} истёк`;
          return days < config.certWarnDays
            ? `сертификат ${clinic.domain} истекает через ${days} дн.`
            : undefined;
        },
      );
    })(),
  );

  const results = await Promise.all(checks);
  return results.filter((f): f is Finding => f !== undefined);
}

export function checkServer(config: MonitorConfig, probes: Probes): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<number>();
  for (const path of config.diskPaths) {
    const base = {
      key: `server:disk:${path}`,
      scope: "server",
      title: `Диск ${path}`,
    };
    try {
      if (!probes.exists(path)) continue;
      const { device, free, total } = probes.disk(path);
      if (seen.has(device)) continue; // тот же раздел — одна тревога
      seen.add(device);
      const pct = total > 0 ? (free / total) * 100 : 0;
      findings.push({
        ...base,
        problem:
          pct < config.diskMinFreePercent ||
          free < config.diskMinFreeMb * 1024 ** 2
            ? `свободно ${Math.floor(pct)}% (${gb(free)})`
            : undefined,
      });
    } catch {
      findings.push({ ...base, problem: "проверка не выполнена" });
    }
  }
  const memory = {
    key: "server:memory",
    scope: "server",
    title: "Память сервера",
  };
  try {
    const { available, total } = probes.memory();
    const pct = (available / total) * 100;
    findings.push({
      ...memory,
      problem:
        pct < config.memoryMinAvailablePercent
          ? `доступно ${Math.floor(pct)}% (${gb(available)} из ${gb(total)})`
          : undefined,
    });
  } catch {
    findings.push({ ...memory, problem: "проверка не выполнена" });
  }
  return findings;
}

// --- Реальные проверки -------------------------------------------------------

function systemctl(args: string[]): Promise<string> {
  return new Promise((resolve) =>
    execFile("systemctl", args, { timeout: 10_000 }, (_error, stdout) =>
      resolve(String(stdout ?? "").trim()),
    ),
  );
}

export const systemProbes: Probes = {
  unitEnabled: async (unit) =>
    (await systemctl(["is-enabled", unit])) === "enabled",
  unitActive: async (unit) =>
    (await systemctl(["is-active", unit])) || "unknown",
  unitMemory: async (unit) => {
    const [current, max] = (
      await systemctl([
        "show",
        unit,
        "-p",
        "MemoryCurrent",
        "-p",
        "MemoryMax",
        "--value",
      ])
    ).split("\n");
    const n = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
    return { current: n(current), max: n(max) };
  },
  lastPoll: async (dbPath) => {
    // Только чтение: работает и с разделом «только для чтения» (ProtectSystem=strict).
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      db.exec("PRAGMA busy_timeout = 3000");
      return (
        db
          .prepare("SELECT value FROM bot_status WHERE key = 'last_poll_at'")
          .get() as { value: string } | undefined
      )?.value;
    } finally {
      db.close();
    }
  },
  httpStatus: async (url, timeoutMs) =>
    (
      await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      })
    ).status,
  certificate: (domain, timeoutMs) =>
    new Promise((resolve, reject) => {
      const socket = connect({
        host: "127.0.0.1",
        port: 443,
        servername: domain,
        rejectUnauthorized: false,
        timeout: timeoutMs,
      });
      socket.once("secureConnect", () => {
        const cert = socket.getPeerCertificate() as PeerCertificate;
        socket.end();
        if (!cert?.valid_to) return reject(new Error("no cert"));
        resolve({
          validTo: new Date(cert.valid_to),
          matches: checkServerIdentity(domain, cert) === undefined,
        });
      });
      socket.once("timeout", () => {
        socket.destroy();
        reject(new Error("timeout"));
      });
      socket.once("error", reject);
    }),
  readText: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
  },
  exists: (path) => existsSync(path),
  disk: (path) => {
    const s = statfsSync(path);
    return {
      device: statSync(path).dev,
      free: s.bavail * s.bsize,
      total: s.blocks * s.bsize,
    };
  },
  memory: () => {
    const info = readFileSync("/proc/meminfo", "utf8");
    const kb = (name: string) =>
      Number(new RegExp(`^${name}:\\s+(\\d+) kB`, "m").exec(info)?.[1] ?? NaN) *
      1024;
    return { available: kb("MemAvailable"), total: kb("MemTotal") };
  },
};
