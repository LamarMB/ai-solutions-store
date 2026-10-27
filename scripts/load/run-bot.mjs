/**
 * Серия нагрузочных прогонов VK-бота (bot-load.mts) на свежих копиях
 * ЛОКАЛЬНОЙ тестовой базы. Процесс бота — на ядрах SERVER_CPUS.
 *
 *   node scripts/load/run-bot.mjs --template=…/template.sqlite --out=dir \
 *     --levels=10,25,50 --model-ms=0,1500 --repeats=1 --duration=60
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
const MODELS = (args["model-ms"] ?? "0").split(",").map(Number);
const MAX_FOR_MODEL = Number(args["model-max-patients"] ?? 50);
const REPEATS = Number(args.repeats ?? 1);
const CPUS = args["server-cpus"] ?? "0,1";
mkdirSync(OUT, { recursive: true });

const results = [];
for (const modelMs of MODELS) {
  for (const patients of LEVELS) {
    // С медленной моделью очередь растёт уже на малых уровнях — выше не нужно.
    if (modelMs > 0 && patients > MAX_FOR_MODEL) continue;
    for (let rep = 1; rep <= REPEATS; rep++) {
      const db = join(OUT, `bot-${modelMs}-${patients}-${rep}.sqlite`);
      for (const f of [db, `${db}-wal`, `${db}-shm`])
        rmSync(f, { force: true });
      copyFileSync(TEMPLATE, db);
      const file = join(OUT, `bot-${modelMs}-${patients}-${rep}.json`);
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
          `--warmup=${args.warmup ?? 10}`,
          `--duration=${args.duration ?? 60}`,
          `--think=${args.think ?? "3000-10000"}`,
          `--model-ms=${modelMs}`,
          `--vk-ms=${args["vk-ms"] ?? 100}`,
          `--out=${file}`,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      console.log(line.trim());
      results.push({ rep, ...JSON.parse(readFileSync(file, "utf8")) });
    }
  }
}
writeFileSync(join(OUT, "summary.json"), JSON.stringify(results, null, 1));
