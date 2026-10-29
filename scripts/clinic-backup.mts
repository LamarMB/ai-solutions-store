/**
 * Зашифрованные резервные копии базы клиники (docs/backup-restore.md).
 * Настройки — из окружения (сервис demo-med-backup@<id> или new-clinic.sh):
 * CLINIC_ID, BOT_DB_PATH и файл /etc/demo-med/backup/<id>.env. Значения
 * ключей и адреса с подписью не печатаются.
 *
 *   init --id=<id> --out=<файл> [--others=<каталог>]  файл настроек с новым BACKUP_KEY
 *   check [--env=<файл>] [--clinic-env=<файл>] [--others=<каталог>]
 *   run                     снимок → шифрование → хранилище → проверка → срок хранения
 *   list                    копии клиники во внешнем хранилище (новые первыми)
 *   verify [--name=<копия>] проверка восстановлением (по умолчанию — последняя), без записи в базу
 *   restore (--name=<копия> | --file=<.dmbk>) --out=<новый файл>
 *                           расшифровка в НОВЫЙ файл с проверкой; рабочая база не трогается
 *
 * Код выхода 1 — ошибка (причина в журнале).
 */
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { loadBackupConfig, type Env } from "@/backup/config";
import { listBackups, restoreBackup, runBackup } from "@/backup/run";

const ROOT = resolve(import.meta.dirname, "..");
const [command] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const option = (name: string) =>
  process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(name.length + 3)
    .trim();
const log = (message: string) => console.log(`[backup] ${message}`);
const fail = (message: string): never => {
  console.log(`[backup] ошибка: ${message}`);
  process.exit(1);
};
const readEnv = (path: string) => parseEnv(readFileSync(path, "utf8")) as Env;

function config() {
  const env: Env = option("env")
    ? { ...process.env, ...readEnv(option("env")!) }
    : process.env;
  const result = loadBackupConfig(env);
  if (!result.ok) {
    for (const e of result.errors) console.log(`[backup] FAIL ${e}`);
    fail("настройки резервного копирования неверны");
  }
  return result as Extract<typeof result, { ok: true }>;
}

async function main() {
  switch (command) {
    case "init": {
      const id = option("id") ?? "";
      const out = option("out");
      if (!/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/.test(id) || !out)
        fail("init --id=<id> --out=<файл>");
      const template = readFileSync(
        join(ROOT, "deploy/clinic/backup.env.example"),
        "utf8",
      );
      const text = template
        .replace(
          /^BACKUP_KEY=.*$/m,
          `BACKUP_KEY=${randomBytes(32).toString("base64")}`,
        )
        .replaceAll("<clinic-id>", id);
      writeFileSync(out!, text, { flag: "wx", mode: 0o600 });
      log(
        `создан ${out}: задайте BACKUP_TARGET и доступ к хранилищу. Сохраните BACKUP_KEY вне сервера — без него копии не расшифровать`,
      );
      return;
    }
    case "check": {
      const { config: c, warnings } = config();
      const errors: string[] = [];
      // Ключ копий — отдельный от MEDICAL_DATA_KEY и свой у каждой клиники.
      const key = c.key.toString("base64");
      if (option("clinic-env")) {
        const clinicEnv = readEnv(option("clinic-env")!);
        if (clinicEnv.MEDICAL_DATA_KEY?.trim() === key)
          errors.push("BACKUP_KEY: должен отличаться от MEDICAL_DATA_KEY");
      }
      const dir = option("others");
      if (dir)
        for (const file of readdirSync(dir).filter((f) => f.endsWith(".env"))) {
          const path = join(dir, file);
          if (option("env") && resolve(path) === resolve(option("env")!))
            continue;
          if (readEnv(path).BACKUP_KEY?.trim() === key)
            errors.push(
              `BACKUP_KEY: совпадает с ключом клиники «${file.slice(0, -4)}» — у каждой клиники свой`,
            );
        }
      for (const w of warnings) log(`WARN ${w}`);
      for (const e of errors) log(`FAIL ${e}`);
      if (errors.length > 0) fail("настройки резервного копирования неверны");
      log(`OK   настройки проверены; хранилище — ${c.storage.label}`);
      return;
    }
    case "run": {
      const { config: c, warnings } = config();
      for (const w of warnings) log(`предупреждение: ${w}`);
      try {
        await runBackup(c, { log });
      } catch {
        process.exit(1); // причина уже в журнале
      }
      return;
    }
    case "list": {
      const { config: c } = config();
      const names = await listBackups(c).catch((e: Error) => fail(e.message));
      for (const n of names) console.log(n);
      log(`копий: ${names.length}`);
      return;
    }
    case "verify": {
      const { config: c } = config();
      const name =
        option("name") ??
        (await listBackups(c).catch((e: Error) => fail(e.message)))[0];
      if (!name) fail("копий в хранилище нет");
      const out = join(c.stagingDir, `verify-${process.pid}.sqlite`);
      try {
        const { header, summary } = await restoreBackup(
          c,
          { name: name! },
          out,
        );
        log(
          `OK   ${name}: от ${header.createdAt}, схема v${summary.schema}, таблиц ${summary.tables}, записей ${summary.bookings}`,
        );
      } catch (e) {
        fail((e as Error).message);
      } finally {
        rmSync(out, { force: true });
      }
      return;
    }
    case "restore": {
      const { config: c } = config();
      const out = option("out");
      const name = option("name");
      const file = option("file");
      if (!out || (!name && !file))
        fail("restore (--name=<копия> | --file=<.dmbk>) --out=<новый файл>");
      try {
        const { header, summary } = await restoreBackup(
          c,
          name ? { name } : { file: file! },
          out!,
        );
        log(
          `OK   восстановлено в ${out}: копия от ${header.createdAt}, схема v${summary.schema}, записей ${summary.bookings}. Рабочая база не изменена — замена по docs/backup-restore.md`,
        );
      } catch (e) {
        fail((e as Error).message);
      }
      return;
    }
    default:
      fail(
        "команды: init, check, run, list, verify, restore — см. начало файла",
      );
  }
}

await main();
