/**
 * Серия нагрузочных прогонов HTTP на ЛОКАЛЬНОЙ машине: для каждого уровня —
 * свежая копия тестовой базы, `next start` на ядрах SERVER_CPUS (модель VPS с
 * 2 vCPU), генератор на ядрах LOAD_CPUS, прогрев, замер, проверка двойных
 * записей в базе. Перед запуском: `npm run build`.
 *
 *   LOAD_ADMIN_PASSWORD=… node scripts/load/run-http.mjs --levels=10,25,50 --repeats=3 --out=dir
 *
 * Продакшен, VPS и внешние API (VK, OpenAI) не используются.
 */
import { spawn, execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : "1"];
  }),
);
const OUT = args.out ?? ".data/load";
const LEVELS = (args.levels ?? "10,25,50,100,200,500").split(",").map(Number);
const REPEATS = Number(args.repeats ?? 3);
const WARMUP = args.warmup ?? "15";
const DURATION = args.duration ?? "45";
const THINK = args.think ?? "1000-3000";
const ADMINS = args.admins ?? "2";
const BURSTS = (args.bursts ?? "10,50,200,500").split(",").filter(Boolean);
const SERVER_CPUS = args["server-cpus"] ?? "0,1";
const LOAD_CPUS = args["load-cpus"] ?? "2,3";
const PORT = Number(args.port ?? 3400);
const USERS = 600;
const SECRET = "load-test-secret-not-real";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!process.env.LOAD_ADMIN_PASSWORD) {
  console.error("Задайте LOAD_ADMIN_PASSWORD (пароль тестового сотрудника).");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

// Шаблон базы и параметры запуска — один раз.
const template = join(OUT, "template.sqlite");
const launchFile = join(OUT, "launch.json");
if (!existsSync(template)) {
  execFileSync(
    "npx",
    [
      "tsx",
      "scripts/load/prepare.mts",
      `--db=${template}`,
      `--out=${launchFile}`,
      `--users=${USERS}`,
      `--secret=${SECRET}`,
    ],
    { stdio: "inherit" },
  );
  // Всё из WAL — в основной файл, чтобы копия была полной.
  const db = new DatabaseSync(template);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
}
const { firstUserId } = JSON.parse(readFileSync(launchFile, "utf8"));
const allowed = Array.from({ length: USERS }, (_, i) => firstUserId + i).join(
  ",",
);

function descendants(pid) {
  const out = [pid];
  for (const dir of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    try {
      const stat = readFileSync(`/proc/${dir}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      if (ppid === pid) out.push(...descendants(Number(dir)));
    } catch {
      // процесс уже завершился
    }
  }
  return out;
}

async function startServer(dbPath) {
  const child = spawn(
    "taskset",
    ["-c", SERVER_CPUS, "npx", "next", "start", "-p", String(PORT)],
    {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "production",
        BOT_DB_PATH: dbPath,
        VK_MINIAPP_ID: "51000001",
        VK_MINIAPP_SECRET: SECRET,
        MINIAPP_ALLOWED_USER_IDS: allowed,
        VK_GROUP_ID: "1",
      },
    },
  );
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/miniapp/clinic`);
      if (r.status) break;
    } catch {
      await sleep(500);
    }
  }
  return { child, log: () => log };
}

function stopServer(server) {
  try {
    process.kill(-server.child.pid, "SIGTERM");
  } catch {
    // уже остановлен
  }
  return sleep(1500);
}

function generator(extra) {
  return new Promise((resolve, reject) => {
    const g = spawn(
      "taskset",
      [
        "-c",
        LOAD_CPUS,
        "node",
        "scripts/load/http-load.mjs",
        `--base=http://127.0.0.1:${PORT}`,
        `--launch=${launchFile}`,
        ...extra,
      ],
      { stdio: ["ignore", "pipe", "inherit"], env: process.env },
    );
    let out = "";
    g.stdout.on("data", (d) => (out += d));
    g.on("exit", (code) =>
      code === 0
        ? resolve(out.trim())
        : reject(new Error(`генератор: ${code}`)),
    );
  });
}

function dbCheck(dbPath) {
  const db = new DatabaseSync(dbPath);
  const doubles = db
    .prepare(
      `SELECT doctor_id, date, time, COUNT(*) AS n FROM bookings
       WHERE cancelled_at IS NULL GROUP BY doctor_id, date, time HAVING n > 1`,
    )
    .all();
  const counts = db
    .prepare("SELECT status, COUNT(*) AS n FROM bookings GROUP BY status")
    .all();
  db.close();
  return {
    doubleBookings: doubles.length,
    byStatus: Object.fromEntries(counts.map((r) => [r.status, r.n])),
  };
}

const lockLines = (log) =>
  log
    .split("\n")
    .filter((l) => /locked|SQLITE_BUSY|busy/i.test(l))
    .slice(0, 5);

const results = [];
for (const level of LEVELS) {
  for (let rep = 1; rep <= REPEATS; rep++) {
    const dbPath = join(OUT, `run-${level}-${rep}.sqlite`);
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`])
      rmSync(f, { force: true });
    copyFileSync(template, dbPath);
    const server = await startServer(dbPath);
    const pids = descendants(server.child.pid);
    const file = join(OUT, `mix-${level}-${rep}.json`);
    try {
      const line = await generator([
        `--vus=${level}`,
        `--warmup=${WARMUP}`,
        `--duration=${DURATION}`,
        `--think=${THINK}`,
        `--admins=${ADMINS}`,
        `--pids=${pids.join(",")}`,
        `--label=vus=${level} #${rep}`,
        `--out=${file}`,
      ]);
      const check = dbCheck(dbPath);
      const result = {
        ...JSON.parse(readFileSync(file, "utf8")),
        ...check,
        sqliteLockLogLines: lockLines(server.log()),
      };
      writeFileSync(file, JSON.stringify(result, null, 1));
      results.push(result);
      console.log(`${line} | двойных записей: ${check.doubleBookings}`);
    } finally {
      await stopServer(server);
    }
  }
}

// Гонка за один слот: свежая база, все пациенты одновременно.
for (const size of BURSTS) {
  const dbPath = join(OUT, `burst-${size}.sqlite`);
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`])
    rmSync(f, { force: true });
  copyFileSync(template, dbPath);
  const server = await startServer(dbPath);
  const file = join(OUT, `burst-${size}.json`);
  try {
    await generator([`--burst=${size}`, `--rounds=3`, `--out=${file}`]);
    const result = {
      ...JSON.parse(readFileSync(file, "utf8")),
      ...dbCheck(dbPath),
    };
    writeFileSync(file, JSON.stringify(result, null, 1));
    console.log(
      `burst ${size}: успешных по раундам ${result.results.map((r) => r.ok).join("/")}, ` +
        `p95=${result.p95?.toFixed(0)} мс, двойных записей: ${result.doubleBookings}`,
    );
  } finally {
    await stopServer(server);
  }
}
writeFileSync(join(OUT, "summary.json"), JSON.stringify(results, null, 1));
