/**
 * Сквозной сценарий `npm run e2e:patient-flow` (docs/patient-data.md, раздел 5):
 * запись через VK Mini App → запись в панели → выгрузка JSON → отмена удаления →
 * удаление → слот снова свободен.
 *
 * Только локально: новая временная база в системном временном каталоге,
 * вымышленные клиника и пациенты, ключи генерируются на один запуск, `next start`
 * на 127.0.0.1 со случайным портом. ВКонтакте, VPS и рабочие базы не используются.
 * Временный каталог удаляется и сервер останавливается в любом случае (ошибка,
 * Ctrl+C). Отчёт — в .data/e2e/patient-flow-<время>/ (в Git не попадает); при
 * падении туда же копируются снимки экранов и журнал сервера.
 *
 * Нужны сборка (`npm run build`) и Playwright с Chromium — он не входит в
 * зависимости проекта: `npm i --no-save playwright && npx playwright install chromium`
 * или глобальная установка. Свой Chromium — E2E_CHROMIUM_PATH.
 * E2E_KEEP_SHOTS=1 — сохранять снимки и при успехе.
 */
import { spawn, execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runPatientFlow } from "./patient-flow.steps.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const VK_ID = "900100";
const OTHER_VK_ID = "900777";
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const ARTIFACTS = join(ROOT, ".data", "e2e", `patient-flow-${stamp}`);

let tmp;
let server;
let serverLog = "";
let cleaning;

function loadChromium() {
  const require = createRequire(join(ROOT, "package.json"));
  try {
    return require("playwright").chromium;
  } catch {
    /* нет локальной установки — пробуем глобальную */
  }
  try {
    const global = execSync("npm root -g", { encoding: "utf8" }).trim();
    return require(join(global, "playwright")).chromium;
  } catch {
    throw new Error(
      "Playwright не найден: npm i --no-save playwright && npx playwright install chromium",
    );
  }
}

function freePort() {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

function run(args, env) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", fail);
    child.on("exit", (code) =>
      code === 0
        ? done(out)
        : fail(new Error(`${args[1]}: код ${code}\n${out.slice(-2000)}`)),
    );
  });
}

async function waitReady(base) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw new Error(`сервер завершился: ${serverLog.slice(-2000)}`);
    try {
      const r = await fetch(`${base}/admin/login`);
      if (r.ok) return;
    } catch {
      /* ещё запускается */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("сервер не ответил за 60 с");
}

async function stopServer() {
  if (!server || server.exitCode !== null || server.signalCode) return;
  const exited = new Promise((r) => server.once("exit", r));
  if (process.platform === "win32")
    try {
      execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" });
    } catch {
      /* уже остановлен */
    }
  else process.kill(-server.pid, "SIGTERM");
  const timer = setTimeout(() => {
    try {
      if (process.platform !== "win32") process.kill(-server.pid, "SIGKILL");
    } catch {
      /* уже остановлен */
    }
  }, 5000);
  await exited;
  clearTimeout(timer);
}

/** Сервер и временный каталог (база, ключи, выгрузка) — при любом исходе. */
function cleanup() {
  cleaning ??= (async () => {
    await stopServer().catch((e) =>
      console.error(`Не удалось остановить сервер: ${e.message}`),
    );
    if (tmp)
      rmSync(tmp, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200,
      });
  })();
  return cleaning;
}

for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    console.error(`\nПрервано (${signal}): удаляю временные данные…`);
    void cleanup().finally(() => process.exit(130));
  });

let ok = false;
try {
  const buildId = join(ROOT, ".next", "BUILD_ID");
  if (!existsSync(buildId))
    throw new Error("Нет сборки: сначала npm run build.");
  console.log(
    `Сборка от ${statSync(buildId).mtime.toLocaleString("ru-RU")} — после изменений кода пересоберите (npm run build).`,
  );
  const chromium = loadChromium();

  tmp = mkdtempSync(join(realpathSync(tmpdir()), "e2e-patient-flow-"));
  const shots = join(tmp, "shots");
  mkdirSync(shots);
  const dbPath = join(tmp, "bot.sqlite");
  const owner = {
    login: "e2e-owner",
    password: randomBytes(18).toString("base64url"),
  };
  const miniApp = {
    appId: "54834865", // вымышленный
    secret: randomBytes(24).toString("hex"),
  };

  const seed = await run(
    [
      join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
      join(ROOT, "scripts", "e2e", "patient-flow-seed.mts"),
    ],
    {
      ...process.env,
      BOT_DB_PATH: dbPath,
      E2E_TMP_ROOT: tmp,
      MEDICAL_DATA_KEY: randomBytes(32).toString("base64"),
      E2E_OWNER_LOGIN: owner.login,
      E2E_OWNER_PASSWORD: owner.password,
      E2E_OTHER_VK_ID: OTHER_VK_ID,
    },
  );
  const { otherBookingId } = JSON.parse(seed.trim().split("\n").at(-1));

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  // Явные значения важнее .env.local (Next.js его не переопределяет):
  // рабочая база и настоящие ключи Mini App в сценарий не попадут.
  server = spawn(
    process.execPath,
    [
      join(ROOT, "node_modules", "next", "dist", "bin", "next"),
      "start",
      "-H",
      "127.0.0.1",
      "-p",
      String(port),
    ],
    {
      cwd: ROOT,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        NODE_ENV: "production",
        BOT_DB_PATH: dbPath,
        ADMIN_COOKIE_SECURE: "false",
        ADMIN_ALLOWED_ORIGINS: "",
        VK_MINIAPP_ID: miniApp.appId,
        VK_MINIAPP_SECRET: miniApp.secret,
        MINIAPP_ALLOWED_USER_IDS: VK_ID,
        VK_ALLOWED_USER_IDS: "",
        VK_GROUP_ID: "",
        MINIAPP_LAUNCH_MAX_AGE_HOURS: "",
      },
    },
  );
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));
  await waitReady(base);

  const report = await runPatientFlow({
    chromium,
    launchOptions: process.env.E2E_CHROMIUM_PATH
      ? { executablePath: process.env.E2E_CHROMIUM_PATH }
      : undefined,
    base,
    shots,
    work: tmp,
    vkId: VK_ID,
    otherBookingId,
    miniApp,
    owner,
  });
  ok = report.ok;

  mkdirSync(ARTIFACTS, { recursive: true });
  if (!ok || process.env.E2E_KEEP_SHOTS === "1")
    cpSync(shots, ARTIFACTS, { recursive: true });
  else
    writeFileSync(
      join(ARTIFACTS, "report.json"),
      readFileSync(join(shots, "report.json")),
    );
  if (!ok) writeFileSync(join(ARTIFACTS, "server.log"), serverLog);
} catch (e) {
  console.error(`Ошибка сценария: ${e.message}`);
  try {
    mkdirSync(ARTIFACTS, { recursive: true });
    if (tmp && existsSync(join(tmp, "shots")))
      cpSync(join(tmp, "shots"), ARTIFACTS, { recursive: true });
    writeFileSync(join(ARTIFACTS, "error.txt"), `${e.stack ?? e}\n`);
    if (serverLog) writeFileSync(join(ARTIFACTS, "server.log"), serverLog);
  } catch {
    /* отчёт не сохранился — ошибка уже выведена */
  }
} finally {
  await cleanup();
}

console.log(
  `${ok ? "E2E patient-flow: пройден" : "E2E patient-flow: ОШИБКА"}. Отчёт: ${ARTIFACTS}`,
);
process.exit(ok ? 0 : 1);
