/**
 * Серия нагрузочных прогонов VK-бота (bot-load.mts) на свежих копиях
 * ЛОКАЛЬНОЙ тестовой базы: «до» (последовательно) и «после» (параллельно).
 * Процесс бота — на ядрах --cpus.
 *
 *   node scripts/load/run-bot.mjs --template=…/template.sqlite --out=dir \
 *     --levels=10,25,50 --modes=sequential,parallel --model=none --duration=60 \
 *     [--extra="--vk-rps=15 --concurrency=8"]
 *
 * Задержки заглушек VK и модели — допущения, а не замеры внешних сервисов.
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : "1"];
  }),
);
const OUT = args.out ?? ".data/load-bot";
const TEMPLATE = args.template;
const LEVELS = (args.levels ?? "10,25,50,100,200,500").split(",").map(Number);
const MODES = (args.modes ?? "sequential,parallel").split(",");
const MODEL = args.model ?? "none";
const MODEL_MS = args["model-ms"] ?? "1500";
const REPEATS = Number(args.repeats ?? 1);
const CPUS = args.cpus ?? "0,1";
const EXTRA = (args.extra ?? "").split(" ").filter(Boolean);
const PARALLEL_EXTRA = (args["parallel-extra"] ?? "--vk-rps=15")
  .split(" ")
  .filter(Boolean);
const TAG = args.tag ?? MODEL;
mkdirSync(OUT, { recursive: true });

const results = [];
for (const patients of LEVELS) {
  for (const mode of MODES) {
    for (let rep = 1; rep <= REPEATS; rep++) {
      const name = `${TAG}-${mode}-${patients}-${rep}`;
      const db = join(OUT, `${name}.sqlite`);
      for (const f of [db, `${db}-wal`, `${db}-shm`])
        rmSync(f, { force: true });
      copyFileSync(TEMPLATE, db);
      const file = join(OUT, `${name}.json`);
      const line = execFileSync(
        "taskset",
        [
          "-c",
          CPUS,
          "npx",
          "tsx",
          "scripts/load/bot-load.mts",
          `--db=${db}`,
          `--patients=${patients}`,
          `--mode=${mode}`,
          `--model=${MODEL}`,
          `--model-ms=${MODEL === "client" ? MODEL_MS : 0}`,
          `--warmup=${args.warmup ?? 10}`,
          `--duration=${args.duration ?? 60}`,
          `--think=${args.think ?? "3000-10000"}`,
          `--vk-ms=${args["vk-ms"] ?? 100}`,
          ...(mode === "parallel" ? PARALLEL_EXTRA : []),
          ...EXTRA,
          `--out=${file}`,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      console.log(line.trim());
      results.push({
        name,
        rep,
        ...JSON.parse(readFileSync(file, "utf8")),
      });
      rmSync(db, { force: true });
      rmSync(`${db}-wal`, { force: true });
      rmSync(`${db}-shm`, { force: true });
    }
  }
}
writeFileSync(
  join(OUT, `summary-${TAG}.json`),
  JSON.stringify(results, null, 1),
);
