/**
 * Экземпляр «Демо-Мед» для отдельной клиники (docs/clinic-instance-deploy.md).
 * Значения переменных и секреты не печатаются — только имена и причины.
 *
 *   init  --id=<id> --port=<3100–3999> --domain=<домен> --out=<файл>
 *         [--others=<каталог настроек клиник>] [--data-root=/var/lib/demo-med]
 *         Файл настроек из шаблона; MEDICAL_DATA_KEY генерируется. Не перезаписывает.
 *   check --env=<файл> [--others=<каталог>] [--port-free] [--data-root=…] [--app=…]
 *         Проверка до запуска: обязательные переменные, заполнители, права файла,
 *         конфликты с другими клиниками (порт, домен, база, сообщество, секреты).
 *   check --self [--port-free]
 *         То же для окружения процесса (ExecStartPre в systemd).
 *   nginx --env=<файл> [--http-only]
 *         Конфигурация nginx экземпляра — в stdout.
 *
 * Код выхода 1 — есть ошибки: экземпляр запускать нельзя.
 */
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { basename, join, resolve } from "node:path";
import { parseEnv } from "node:util";
import {
  checkConflicts,
  checkEnvFileMode,
  checkInstance,
  CLINIC_ID_RE,
  dbPathFor,
  DEFAULT_LAYOUT,
  PANEL_PORT_MAX,
  PANEL_PORT_MIN,
  placeholders,
  renderNginx,
  type Env,
  type InstanceLayout,
} from "@/deploy/instance";

const ROOT = resolve(import.meta.dirname, "..");
const [command] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const option = (name: string) =>
  process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(name.length + 3)
    .trim();
const flag = (name: string) => process.argv.includes(`--${name}`);

const layout: InstanceLayout = {
  dataRoot: option("data-root") ?? DEFAULT_LAYOUT.dataRoot,
  appDir:
    option("app") ?? (flag("self") ? process.cwd() : DEFAULT_LAYOUT.appDir),
};

const readEnv = (path: string): Env =>
  parseEnv(readFileSync(path, "utf8")) as Env;

/** Файлы настроек других клиник в каталоге (кроме проверяемого). */
function others(dir: string | undefined, except?: string) {
  if (!dir) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".env"))
    .map((f) => join(dir, f))
    .filter((p) => !except || resolve(p) !== resolve(except))
    .map((p) => ({ name: basename(p, ".env"), env: readEnv(p) }));
}

function portFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const server = createServer();
    server.once("error", () => done(false));
    server.listen(port, "127.0.0.1", () => server.close(() => done(true)));
  });
}

function report(errors: string[], warnings: string[] = []) {
  for (const w of warnings) console.log(`WARN ${w}`);
  for (const e of errors) console.log(`FAIL ${e}`);
  if (errors.length > 0) {
    console.log(`Ошибок: ${errors.length}. Экземпляр не запускать.`);
    process.exit(1);
  }
  console.log("OK   настройки экземпляра проверены");
}

async function check() {
  const self = flag("self");
  const path = option("env");
  if (!self && !path) {
    report(["укажите --env=<файл настроек> или --self"]);
    return;
  }
  const env: Env = self ? process.env : readEnv(path!);
  const errors: string[] = [];
  const result = checkInstance(env, layout);
  errors.push(...result.errors);
  // В окружении процесса есть и системные переменные — их не проверяем.
  const warnings = self
    ? result.warnings.filter((w) => !w.includes("неизвестная переменная"))
    : result.warnings;
  if (!self) {
    errors.push(...placeholders(env), ...checkEnvFileMode(path!));
    const list = others(option("others"), path);
    errors.push(
      ...checkConflicts([{ name: basename(path!, ".env"), env }, ...list]),
    );
  }
  if (flag("port-free")) {
    const port = Number(env.PANEL_PORT);
    if (Number.isInteger(port) && !(await portFree(port)))
      errors.push(
        "PANEL_PORT: порт уже занят другим процессом на 127.0.0.1 — выберите другой",
      );
  }
  report(errors, warnings);
}

function init() {
  const id = option("id") ?? "";
  const port = Number(option("port"));
  const domain = (option("domain") ?? "").toLowerCase();
  const out = option("out");
  const errors: string[] = [];
  if (!CLINIC_ID_RE.test(id))
    errors.push("--id: латиница, цифры, дефис (3–32)");
  if (!Number.isInteger(port) || port < PANEL_PORT_MIN || port > PANEL_PORT_MAX)
    errors.push(`--port: от ${PANEL_PORT_MIN} до ${PANEL_PORT_MAX}`);
  if (!domain) errors.push("--domain: домен панели");
  if (!out) errors.push("--out: путь к файлу настроек");
  const draft: Env = {
    CLINIC_ID: id,
    PANEL_PORT: String(port),
    PANEL_DOMAIN: domain,
    BOT_DB_PATH: dbPathFor(layout, id),
  };
  // Порт, домен и база не должны совпасть с уже созданными клиниками.
  errors.push(
    ...checkConflicts([{ name: id, env: draft }, ...others(option("others"))]),
  );
  if (errors.length > 0) report(errors);
  const template = readFileSync(
    join(ROOT, "deploy/clinic/clinic.env.example"),
    "utf8",
  );
  const set = (text: string, key: string, value: string) =>
    text.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`);
  let text = template;
  for (const [key, value] of Object.entries(draft))
    text = set(text, key, value!);
  text = set(text, "MEDICAL_DATA_KEY", randomBytes(32).toString("base64"));
  // wx — не перезаписывать существующие настройки; 600 — только владелец.
  writeFileSync(out!, text, { flag: "wx", mode: 0o600 });
  console.log(
    `OK   создан ${out}: заполните VK_GROUP_ID, VK_GROUP_TOKEN, VK_ALLOWED_USER_IDS, VK_ADMIN_USER_ID (MEDICAL_DATA_KEY уже создан)`,
  );
}

function nginx() {
  const path = option("env");
  if (!path) return report(["укажите --env=<файл настроек>"]);
  const env = readEnv(path);
  const errors = checkInstance(env, {
    ...layout,
    appDir: undefined,
  }).errors.filter((e) =>
    /^(CLINIC_ID|PANEL_PORT|PANEL_DOMAIN|TRUSTED_PROXY_IPS)/.test(e),
  );
  if (errors.length > 0) return report(errors);
  const template = readFileSync(
    join(ROOT, "deploy/nginx/clinic.conf.template"),
    "utf8",
  );
  process.stdout.write(
    renderNginx(template, env, { httpOnly: flag("http-only") }),
  );
}

switch (command) {
  case "check":
    await check();
    break;
  case "init":
    init();
    break;
  case "nginx":
    nginx();
    break;
  default:
    console.log("Команды: init, check, nginx — см. начало файла.");
    process.exit(1);
}
