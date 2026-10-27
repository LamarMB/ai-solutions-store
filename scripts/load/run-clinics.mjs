/**
 * Модель 20 клиник на ОДНОЙ машине: в коде нет многоклиентской архитектуры
 * (одна база BOT_DB_PATH и одна клиника на процесс), поэтому каждая клиника —
 * ОТДЕЛЬНЫЙ экземпляр `next start` со своей тестовой базой и своим расписанием
 * (prepare.mts --variant). Это не изоляция клиник внутри одной системы.
 *
 *   LOAD_ADMIN_PASSWORD=… node scripts/load/run-clinics.mjs --clinics=20 \
 *     --patients=5,8,10,… --duration=45 --out=dir
 *
 * Все серверы — на ядрах SERVER_CPUS (модель VPS с 2 vCPU), генераторы — на
 * LOAD_CPUS. Замеряются память всех экземпляров без нагрузки и под нагрузкой,
 * CPU и задержки по каждой клинике. Продакшен и внешние API не используются.
 */
import { spawn, execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : "1"];
  }),
);
const OUT = args.out ?? ".data/load-clinics";
const CLINICS = Number(args.clinics ?? 20);
const PATIENTS = (args.patients ?? "").split(",").filter(Boolean).map(Number);
const WARMUP = args.warmup ?? "15";
const DURATION = args.duration ?? "45";
const THINK = args.think ?? "1000-3000";
const SERVER_CPUS = args["server-cpus"] ?? "0,1";
const LOAD_CPUS = args["load-cpus"] ?? "2,3";
const BASE_PORT = Number(args.port ?? 3500);
const USERS = 120;
const SECRET = "load-test-secret-not-real";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!process.env.LOAD_ADMIN_PASSWORD) {
  console.error("Задайте LOAD_ADMIN_PASSWORD (пароль тестового сотрудника).");
  process.exit(1);
}
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

function procOf(pid) {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
}
function descendants(pid) {
  const out = [pid];
  for (const dir of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    try {
      if (procOf(Number(dir)) === pid) out.push(...descendants(Number(dir)));
    } catch {
      // процесс завершился
    }
  }
  return out;
}
function rssMB(pids) {
  let kb = 0;
  for (const pid of pids) {
    try {
      kb += Number(
        /VmRSS:\s+(\d+)/.exec(
          readFileSync(`/proc/${pid}/status`, "utf8"),
        )?.[1] ?? 0,
      );
    } catch {
      // процесс завершился
    }
  }
  return kb / 1024;
}

// 1. Базы клиник с разными расписаниями.
const clinics = [];
for (let i = 0; i < CLINICS; i++) {
  const db = join(OUT, `clinic-${i + 1}.sqlite`);
  const launch = join(OUT, `launch-${i + 1}.json`);
  execFileSync(
    "npx",
    [
      "tsx",
      "scripts/load/prepare.mts",
      `--db=${db}`,
      `--out=${launch}`,
      `--users=${USERS}`,
      `--secret=${SECRET}`,
      `--variant=${i}`,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  const { firstUserId } = JSON.parse(readFileSync(launch, "utf8"));
  clinics.push({
    index: i + 1,
    db,
    launch,
    port: BASE_PORT + i + 1,
    allowed: Array.from({ length: USERS }, (_, k) => firstUserId + k).join(","),
    patients: PATIENTS[i] ?? 10,
  });
}

// 2. Серверы — по одному на клинику.
for (const c of clinics) {
  c.child = spawn(
    "taskset",
    ["-c", SERVER_CPUS, "npx", "next", "start", "-p", String(c.port)],
    {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        NODE_ENV: "production",
        BOT_DB_PATH: c.db,
        VK_MINIAPP_ID: "51000001",
        VK_MINIAPP_SECRET: SECRET,
        MINIAPP_ALLOWED_USER_IDS: c.allowed,
        VK_GROUP_ID: "1",
      },
    },
  );
}
const stopAll = () => {
  for (const c of clinics) {
    try {
      process.kill(-c.child.pid, "SIGTERM");
    } catch {
      // уже остановлен
    }
  }
};
process.on("exit", stopAll);

try {
  for (const c of clinics) {
    for (let k = 0; k < 240; k++) {
      try {
        await fetch(`http://127.0.0.1:${c.port}/api/miniapp/clinic`);
        break;
      } catch {
        await sleep(500);
      }
    }
  }
  // Прогрев каждого экземпляра одним запросом страницы и API, затем память в покое.
  for (const c of clinics) {
    await fetch(`http://127.0.0.1:${c.port}/miniapp`).catch(() => {});
    c.pids = descendants(c.child.pid);
  }
  await sleep(5000);
  const idleRss = clinics.map((c) => rssMB(c.pids));
  console.log(
    `экземпляров: ${CLINICS}, память в покое: ${idleRss.reduce((a, b) => a + b, 0).toFixed(0)} МБ ` +
      `(на экземпляр ${Math.min(...idleRss).toFixed(0)}–${Math.max(...idleRss).toFixed(0)} МБ)`,
  );

  // 3. Нагрузка на все клиники одновременно.
  const runs = clinics.map(
    (c) =>
      new Promise((resolve, reject) => {
        const file = join(OUT, `clinic-${c.index}.json`);
        const g = spawn(
          "taskset",
          [
            "-c",
            LOAD_CPUS,
            "node",
            "scripts/load/http-load.mjs",
            `--base=http://127.0.0.1:${c.port}`,
            `--launch=${c.launch}`,
            `--vus=${c.patients}`,
            `--warmup=${WARMUP}`,
            `--duration=${DURATION}`,
            `--think=${THINK}`,
            "--admins=1",
            `--pids=${c.pids.join(",")}`,
            `--label=клиника ${c.index}`,
            `--out=${file}`,
          ],
          { stdio: ["ignore", "ignore", "inherit"], env: process.env },
        );
        g.on("exit", (code) =>
          code === 0
            ? resolve(JSON.parse(readFileSync(file, "utf8")))
            : reject(new Error(`генератор клиники ${c.index}: ${code}`)),
        );
      }),
  );
  const results = await Promise.all(runs);
  const doubles = clinics.map((c) => {
    const db = new DatabaseSync(c.db);
    const n = db
      .prepare(
        `SELECT COUNT(*) AS n FROM (SELECT 1 FROM bookings WHERE cancelled_at IS NULL
         GROUP BY doctor_id, date, time HAVING COUNT(*) > 1)`,
      )
      .get().n;
    db.close();
    return n;
  });
  const summary = {
    clinics: CLINICS,
    patientsTotal: clinics.reduce((a, c) => a + c.patients, 0),
    idleRssTotalMB: idleRss.reduce((a, b) => a + b, 0),
    idleRssPerInstanceMB: idleRss,
    loadRssTotalMB: results.reduce((a, r) => a + (r.rssMaxMB ?? 0), 0),
    cpuAvgTotal: results.reduce((a, r) => a + (r.cpuAvg ?? 0), 0),
    rpsTotal: results.reduce((a, r) => a + r.rps, 0),
    errorsTotal: results.reduce((a, r) => a + r.errors, 0),
    requestsTotal: results.reduce((a, r) => a + r.requests, 0),
    doubleBookings: doubles.reduce((a, b) => a + b, 0),
    perClinic: results.map((r, i) => ({
      clinic: i + 1,
      patients: clinics[i].patients,
      rps: r.rps,
      p50: r.p50,
      p95: r.p95,
      p99: r.p99,
      errorRate: r.errorRate,
      cpuAvg: r.cpuAvg,
      rssMaxMB: r.rssMaxMB,
      bookings: r.bookings,
    })),
  };
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
  const p95s = summary.perClinic.map((c) => c.p95);
  console.log(
    `пациентов всего ${summary.patientsTotal}: rps=${summary.rpsTotal.toFixed(1)} ` +
      `p95 по клиникам ${Math.min(...p95s).toFixed(0)}–${Math.max(...p95s).toFixed(0)} мс, ` +
      `ошибок ${summary.errorsTotal}/${summary.requestsTotal}, CPU сумма ${summary.cpuAvgTotal.toFixed(0)}%, ` +
      `память под нагрузкой ${summary.loadRssTotalMB.toFixed(0)} МБ, двойных записей ${summary.doubleBookings}`,
  );
} finally {
  stopAll();
  await sleep(2000);
}
