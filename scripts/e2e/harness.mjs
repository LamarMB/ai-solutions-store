/**
 * Общая обвязка сквозных сценариев (scripts/e2e): временный каталог, сборка,
 * Playwright, `next start` на 127.0.0.1 со случайным портом, заполнение
 * временной базы, отчёт в .data/e2e/ и очистка при любом исходе (ошибка, Ctrl+C).
 * Подход тот же, что в patient-flow.mjs.
 */
import { execSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "../..");

export const secret = (bytes, encoding = "base64url") =>
  randomBytes(bytes).toString(encoding);

export function loadChromium() {
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

export const launchOptions = () =>
  process.env.E2E_CHROMIUM_PATH
    ? { executablePath: process.env.E2E_CHROMIUM_PATH }
    : undefined;

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

/**
 * Сессия сценария `name`: временный каталог и каталог отчёта. cleanup()
 * останавливает сервер и удаляет временный каталог; вызывается и по Ctrl+C.
 */
export function createSession(name) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const artifacts = join(ROOT, ".data", "e2e", `${name}-${stamp}`);
  const tmp = mkdtempSync(join(realpathSync(tmpdir()), `e2e-${name}-`));
  const shots = join(tmp, "shots");
  mkdirSync(shots);
  let server;
  let serverLog = "";
  let cleaning;

  const buildId = join(ROOT, ".next", "BUILD_ID");
  const checkBuild = () => {
    if (!existsSync(buildId))
      throw new Error("Нет сборки: сначала npm run build.");
    console.log(
      `Сборка от ${statSync(buildId).mtime.toLocaleString("ru-RU")} — после изменений кода пересоберите (npm run build).`,
    );
  };

  /** Скрипт .mts через tsx (алиасы @/*); вывод — строкой. */
  const runTsx = (script, env) =>
    new Promise((done, fail) => {
      const child = spawn(
        process.execPath,
        [join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), script],
        { cwd: ROOT, env: { ...process.env, ...env } },
      );
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("error", fail);
      child.on("exit", (code) =>
        code === 0
          ? done(out)
          : fail(new Error(`${script}: код ${code}\n${out.slice(-2000)}`)),
      );
    });

  /**
   * Явные значения важнее .env.local (Next.js его не переопределяет): рабочая
   * база и настоящие ключи в сценарий не попадут.
   */
  async function startServer(env) {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
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
          ADMIN_COOKIE_SECURE: "false",
          ADMIN_ALLOWED_ORIGINS: "",
          ...env,
        },
      },
    );
    server.stdout.on("data", (d) => (serverLog += d));
    server.stderr.on("data", (d) => (serverLog += d));
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (server.exitCode !== null)
        throw new Error(`сервер завершился: ${serverLog.slice(-2000)}`);
      try {
        if ((await fetch(`${base}/admin/login`)).ok) return base;
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

  /** Сервер, дополнительные остановки (`onCleanup`) и временный каталог. */
  const extra = [];
  function cleanup() {
    cleaning ??= (async () => {
      for (const stop of extra.reverse())
        await Promise.resolve()
          .then(stop)
          .catch((e) => console.error(`Остановка: ${e.message}`));
      await stopServer().catch((e) =>
        console.error(`Не удалось остановить сервер: ${e.message}`),
      );
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

  /**
   * Отчёт: при успехе — только report.json (E2E_KEEP_SHOTS=1 — и снимки), при
   * ошибке — всё из shots, журнал сервера и `files` ({имя: содержимое}).
   */
  function saveArtifacts(ok, report, files = {}) {
    try {
      mkdirSync(artifacts, { recursive: true });
      if (!ok || process.env.E2E_KEEP_SHOTS === "1") {
        cpSync(shots, artifacts, { recursive: true });
        for (const [file, content] of Object.entries(files))
          writeFileSync(join(artifacts, file), content);
      }
      if (!ok && serverLog)
        writeFileSync(join(artifacts, "server.log"), serverLog);
      writeFileSync(
        join(artifacts, "report.json"),
        `${JSON.stringify(report, null, 2)}\n`,
      );
    } catch (e) {
      console.error(`Отчёт не сохранён: ${e.message}`);
    }
  }

  return {
    tmp,
    shots,
    artifacts,
    checkBuild,
    runTsx,
    startServer,
    onCleanup: (stop) => extra.push(stop),
    cleanup,
    saveArtifacts,
  };
}
