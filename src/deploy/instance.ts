import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { authConfigFromEnv } from "@/admin/auth";
import { loadBotConfig } from "@/bot/config";
import { miniAppConfigFromEnv } from "@/miniapp/config";

/**
 * Экземпляр системы для одной клиники (docs/clinic-instance-deploy.md): свои
 * процессы бота и панели, системный пользователь, база, секреты и журналы.
 * Здесь — проверка файла настроек экземпляра до запуска и шаблон nginx.
 * Сообщения называют переменную, но никогда не показывают её значение.
 */

/** Раскладка на сервере; в тестах корни подменяются. */
export type InstanceLayout = {
  /** Каталог данных клиник: <dataRoot>/<id>/bot.sqlite. */
  dataRoot: string;
  /** Каталог приложения (текущий выпуск) — общий для всех клиник, без .env. */
  appDir?: string;
};

export const DEFAULT_LAYOUT: InstanceLayout = {
  dataRoot: "/var/lib/demo-med",
  appDir: "/opt/demo-med/current",
};

/** Порты панелей клиник; 3000 оставлен демо-стенду. */
export const PANEL_PORT_MIN = 3100;
export const PANEL_PORT_MAX = 3999;

export const CLINIC_ID_RE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;
const DOMAIN_RE =
  /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const IPV4_RE = /^(\d{1,3})(\.\d{1,3}){3}(\/\d{1,2})?$/;

/** Переменные экземпляра (не читаются приложением — их используют systemd и nginx). */
const INSTANCE_KEYS = [
  "CLINIC_ID",
  "PANEL_PORT",
  "PANEL_DOMAIN",
  "TRUSTED_PROXY_IPS",
] as const;

/** Все переменные, которые понимают бот, панель и Mini App. */
const KNOWN_KEYS = new Set<string>([
  ...INSTANCE_KEYS,
  "BOT_MODE",
  "VK_GROUP_ID",
  "VK_GROUP_TOKEN",
  "VK_ALLOWED_USER_IDS",
  "VK_ADMIN_USER_ID",
  "VK_API_VERSION",
  "VK_MINIAPP_ID",
  "VK_MINIAPP_SECRET",
  "MINIAPP_ALLOWED_USER_IDS",
  "MINIAPP_LAUNCH_MAX_AGE_HOURS",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_DAILY_REQUEST_LIMIT",
  "OPENAI_CONCURRENCY",
  "BOT_CONCURRENCY",
  "BOT_QUEUE_LIMIT",
  "VK_API_RPS",
  "BOT_DB_PATH",
  "BOT_HANDOFF_HOURS",
  "BOT_HISTORY_HOURS",
  "BOT_MESSAGES_PER_MINUTE",
  "BOT_MEDICAL_QUESTIONS",
  "MEDICAL_DATA_KEY",
  "ADMIN_COOKIE_SECURE",
  "ADMIN_ALLOWED_ORIGINS",
]);

/** Секреты: значения не сравниваются вслух и не печатаются. */
const SECRET_KEYS = [
  "VK_GROUP_TOKEN",
  "OPENAI_API_KEY",
  "MEDICAL_DATA_KEY",
  "VK_MINIAPP_SECRET",
] as const;

/** Файлы окружения, которые Next.js и бот читают из каталога приложения. */
const APP_ENV_FILES = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
];

export type Env = Record<string, string | undefined>;
export type CheckResult = { errors: string[]; warnings: string[] };

export const dbPathFor = (layout: InstanceLayout, id: string) =>
  join(layout.dataRoot, id, "bot.sqlite");

/** Проверка одного экземпляра: всё, что можно обнаружить до запуска. */
export function checkInstance(
  env: Env,
  layout: InstanceLayout = DEFAULT_LAYOUT,
): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const value = (key: string) => env[key]?.trim() ?? "";

  const id = value("CLINIC_ID");
  if (!CLINIC_ID_RE.test(id))
    errors.push(
      "CLINIC_ID: латиница в нижнем регистре, цифры и дефис, 3–32 символа, начинается с буквы",
    );

  const port = Number(value("PANEL_PORT"));
  if (!Number.isInteger(port) || port < PANEL_PORT_MIN || port > PANEL_PORT_MAX)
    errors.push(
      `PANEL_PORT: целое число от ${PANEL_PORT_MIN} до ${PANEL_PORT_MAX}`,
    );

  if (!DOMAIN_RE.test(value("PANEL_DOMAIN").toLowerCase()))
    errors.push("PANEL_DOMAIN: доменное имя панели, например panel.clinic.ru");

  for (const ip of value("TRUSTED_PROXY_IPS")
    .split(/[,\s]+/)
    .filter(Boolean))
    if (!IPV4_RE.test(ip))
      errors.push("TRUSTED_PROXY_IPS: IPv4-адреса или сети через запятую");

  // База — только в собственном каталоге клиники.
  if (CLINIC_ID_RE.test(id) && value("BOT_DB_PATH") !== dbPathFor(layout, id))
    errors.push(
      `BOT_DB_PATH: должен быть ${dbPathFor(layout, id)} — у каждой клиники своя база в своём каталоге`,
    );

  // Бот: те же проверки, что при запуске (значения в сообщения не попадают).
  const bot = loadBotConfig(env);
  if (!bot.ok) errors.push(...bot.errors);

  if (!value("MEDICAL_DATA_KEY"))
    errors.push(
      "MEDICAL_DATA_KEY: обязателен для клиники — шифрует разговоры и согласия",
    );

  if (authConfigFromEnv(env).secureCookie === false)
    errors.push(
      "ADMIN_COOKIE_SECURE: false допустим только для локальной проверки, не для клиники",
    );
  for (const origin of value("ADMIN_ALLOWED_ORIGINS")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean))
    if (!/^https:\/\/[^/\s]+$/.test(origin))
      errors.push("ADMIN_ALLOWED_ORIGINS: только адреса вида https://домен");

  if (value("VK_MINIAPP_ID") || value("VK_MINIAPP_SECRET")) {
    const mini = miniAppConfigFromEnv(env);
    if (!mini.ok) errors.push(...mini.errors);
  }

  // Предупреждения: не ошибки, но владелец должен понимать последствия.
  for (const key of Object.keys(env))
    if (!KNOWN_KEYS.has(key))
      warnings.push(`${key}: неизвестная переменная — проверьте написание`);
  if (
    bot.ok &&
    bot.config.mode === "live" &&
    bot.config.vk.allowedUserIds === "all"
  )
    warnings.push(
      "BOT_MODE=live и пустой VK_ALLOWED_USER_IDS: бот отвечает всем пациентам",
    );
  if (bot.ok && bot.config.mode === "demo")
    warnings.push(
      "BOT_MODE=demo: ответы с пометкой «демо» — для клиники-клиента нужен live",
    );
  if (!value("OPENAI_API_KEY"))
    warnings.push(
      "OPENAI_API_KEY не задан: бот работает по кнопкам и правилам",
    );
  if (!value("VK_ADMIN_USER_ID"))
    warnings.push(
      "VK_ADMIN_USER_ID не задан: администратор не получит уведомлений об обращениях",
    );

  if (layout.appDir) {
    const found = APP_ENV_FILES.filter((f) =>
      existsSync(join(layout.appDir!, f)),
    );
    if (found.length > 0)
      errors.push(
        `Каталог приложения содержит ${found.join(", ")}: Next.js и бот прочитают их во всех клиниках — удалите, настройки клиники только в её файле`,
      );
  }
  return { errors, warnings };
}

/**
 * Конфликты между клиниками на одном сервере: порт, домен, база, сообщество
 * ВКонтакте, Mini App и секреты должны быть у каждой свои.
 */
export function checkConflicts(
  instances: readonly { name: string; env: Env }[],
): string[] {
  const errors: string[] = [];
  const unique: [string, string][] = [
    ["CLINIC_ID", "идентификатор клиники"],
    ["PANEL_PORT", "порт панели"],
    ["PANEL_DOMAIN", "домен панели"],
    ["BOT_DB_PATH", "файл базы"],
    [
      "VK_GROUP_ID",
      "сообщество ВКонтакте (два бота не могут читать одно сообщество)",
    ],
    ["VK_MINIAPP_ID", "VK Mini App"],
    ...SECRET_KEYS.map((k): [string, string] => [k, "секрет"]),
  ];
  for (const [key, title] of unique) {
    const seen = new Map<string, string>();
    for (const { name, env } of instances) {
      const v = env[key]?.trim().toLowerCase();
      if (!v) continue;
      const other = seen.get(v);
      if (other)
        errors.push(
          `${key}: ${title} совпадает у «${other}» и «${name}» — у каждой клиники должен быть свой`,
        );
      else seen.set(v, name);
    }
  }
  return errors;
}

/** Права файла настроек: никаких прав для «остальных» (секреты). */
export function checkEnvFileMode(path: string): string[] {
  const mode = statSync(path).mode & 0o777;
  return mode & 0o007
    ? [
        `Файл настроек доступен всем пользователям сервера (права ${mode.toString(8)}): нужно 600 (владелец root)`,
      ]
    : [];
}

/** Заполнители из шаблона, которые забыли заменить. */
export function placeholders(env: Env): string[] {
  return Object.entries(env)
    .filter(([, v]) => v !== undefined && /<[^>]*>|CHANGE_ME/.test(v))
    .map(([k]) => `${k}: не заполнено (осталось значение из шаблона)`);
}

/**
 * nginx для экземпляра: наружу только панель и Mini App, адрес клиента —
 * перезаписывается (приложение берёт последний адрес X-Forwarded-For), строка
 * запуска Mini App не пишется в журнал. Секретов в шаблоне нет.
 */
export function renderNginx(
  template: string,
  env: Env,
  { httpOnly = false }: { httpOnly?: boolean } = {},
): string {
  const proxies = (env.TRUSTED_PROXY_IPS ?? "").split(/[,\s]+/).filter(Boolean);
  const realIp =
    proxies.length > 0
      ? [
          ...proxies.map((ip) => `set_real_ip_from ${ip};`),
          "real_ip_header X-Forwarded-For;",
          "real_ip_recursive on;",
        ].join("\n  ")
      : "# Перед nginx нет доверенного прокси: адрес клиента — $remote_addr.";
  const vars: Record<string, string> = {
    CLINIC_ID: env.CLINIC_ID ?? "",
    PANEL_DOMAIN: (env.PANEL_DOMAIN ?? "").toLowerCase(),
    PANEL_PORT: env.PANEL_PORT ?? "",
    REAL_IP: realIp,
  };
  const body = httpOnly
    ? template.slice(0, template.indexOf("# --- https ---"))
    : template;
  return body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in vars)) throw new Error(`Неизвестный заполнитель ${key}`);
    return vars[key];
  });
}
