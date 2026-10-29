/**
 * Настройки мониторинга экземпляров клиник (docs/monitoring.md): файл
 * /etc/demo-med/monitor.env, права 600 root. Пороги и канал уведомлений меняются
 * без изменения кода. Ошибки — по имени переменной, без значений.
 */
export type MonitorConfig = {
  /** Каталог настроек клиник: из них берутся только CLINIC_ID, PANEL_PORT, PANEL_DOMAIN. */
  clinicsDir: string;
  backupConfDir: string;
  dataRoot: string;
  nginxEnabledDir: string;
  stateFile: string;
  /** Имя сервера в уведомлениях. */
  serverName: string;

  botStaleMinutes: number;
  panelTimeoutMs: number;
  backupMaxAgeHours: number;
  /** Нет настроек копий — тоже тревога (до открытия доступа пациентам копии обязательны). */
  requireBackup: boolean;
  diskPaths: string[];
  diskMinFreePercent: number;
  diskMinFreeMb: number;
  memoryMinAvailablePercent: number;
  unitMemoryMaxPercent: number;
  certWarnDays: number;

  /** Тревога — после стольких неудачных проверок подряд (короткие перезапуски не тревожат). */
  failAfter: number;
  /** Напоминание о неисправленной проблеме — не чаще, часов (0 — не напоминать). */
  remindHours: number;
  /** Ежедневная сводка «мониторинг работает» в этот час (местное время сервера); -1 — нет. */
  dailyReportHour: number;

  telegram?: { token: string; chatId: string; apiBase: string };
};

export type Env = Record<string, string | undefined>;

export function loadMonitorConfig(
  env: Env,
  hostname = "сервер",
): { ok: true; config: MonitorConfig } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const num = (key: string, fallback: number, min: number, max: number) => {
    const raw = env[key]?.trim();
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < min || n > max) {
      errors.push(`${key}: число от ${min} до ${max}`);
      return fallback;
    }
    return n;
  };
  const text = (key: string, fallback: string) => env[key]?.trim() || fallback;

  const token = env.MONITOR_TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const chatId = env.MONITOR_TELEGRAM_CHAT_ID?.trim() ?? "";
  if (token && !/^\d{5,15}:[A-Za-z0-9_-]{30,64}$/.test(token))
    errors.push(
      "MONITOR_TELEGRAM_BOT_TOKEN: формат «123456:ABC…» от @BotFather",
    );
  if (token && !/^-?\d{3,20}$/.test(chatId))
    errors.push("MONITOR_TELEGRAM_CHAT_ID: числовой id чата или группы");
  if (!token && chatId) errors.push("MONITOR_TELEGRAM_BOT_TOKEN: не задан");
  const apiBase = text("MONITOR_TELEGRAM_API", "https://api.telegram.org");
  if (!/^https:\/\/[^/\s]+$|^http:\/\/127\.0\.0\.1(:\d+)?$/.test(apiBase))
    errors.push("MONITOR_TELEGRAM_API: адрес https://… без пути");

  const config: MonitorConfig = {
    clinicsDir: text("MONITOR_CLINICS_DIR", "/etc/demo-med/clinics"),
    backupConfDir: text("MONITOR_BACKUP_CONF_DIR", "/etc/demo-med/backup"),
    dataRoot: text("MONITOR_DATA_ROOT", "/var/lib/demo-med"),
    nginxEnabledDir: text(
      "MONITOR_NGINX_ENABLED_DIR",
      "/etc/nginx/sites-enabled",
    ),
    stateFile: text(
      "MONITOR_STATE_FILE",
      "/var/lib/demo-med-monitor/state.json",
    ),
    serverName: text("MONITOR_SERVER_NAME", hostname),
    botStaleMinutes: num("MONITOR_BOT_STALE_MINUTES", 5, 1, 1440),
    panelTimeoutMs: num("MONITOR_PANEL_TIMEOUT_SECONDS", 5, 1, 60) * 1000,
    backupMaxAgeHours: num("MONITOR_BACKUP_MAX_AGE_HOURS", 30, 1, 24 * 30),
    requireBackup: text("MONITOR_REQUIRE_BACKUP", "true") !== "false",
    diskPaths: text(
      "MONITOR_DISK_PATHS",
      "/,/var/lib/demo-med,/var/backups/demo-med",
    )
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean),
    diskMinFreePercent: num("MONITOR_DISK_MIN_FREE_PERCENT", 10, 0, 99),
    diskMinFreeMb: num("MONITOR_DISK_MIN_FREE_MB", 1024, 0, 10_000_000),
    memoryMinAvailablePercent: num(
      "MONITOR_MEMORY_MIN_AVAILABLE_PERCENT",
      10,
      0,
      99,
    ),
    unitMemoryMaxPercent: num("MONITOR_UNIT_MEMORY_MAX_PERCENT", 90, 1, 100),
    certWarnDays: num("MONITOR_CERT_WARN_DAYS", 14, 1, 365),
    failAfter: num("MONITOR_FAIL_AFTER", 2, 1, 100),
    remindHours: num("MONITOR_REMIND_HOURS", 24, 0, 24 * 30),
    dailyReportHour: num("MONITOR_DAILY_REPORT_HOUR", 9, -1, 23),
    ...(token ? { telegram: { token, chatId, apiBase } } : {}),
  };
  return errors.length > 0 ? { ok: false, errors } : { ok: true, config };
}
