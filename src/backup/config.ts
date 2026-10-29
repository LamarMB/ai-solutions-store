import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseBackupKey } from "@/backup/format";
import { DirStorage, S3Storage, type BackupStorage } from "@/backup/storage";

/**
 * Настройки резервного копирования клиники — отдельный файл
 * /etc/demo-med/backup/<id>.env (deploy/clinic/backup.env.example). Бот и панель
 * его не получают: ключ копий и доступ к хранилищу есть только у задачи
 * копирования. CLINIC_ID и BOT_DB_PATH задаёт сервис systemd.
 */
export type BackupConfig = {
  clinic: string;
  dbPath: string;
  key: Buffer;
  storage: BackupStorage;
  /** Сколько копий хранить во внешнем хранилище; 0 — не удалять (срок задаёт хранилище). */
  keep: number;
  /** Зашифрованные копии на этом же сервере (удобство, не резервирование). */
  localDir?: string;
  localKeep: number;
  /** Временные файлы: каталог данных клиники (права 700). */
  stagingDir: string;
  statusPath: string;
};

export type Env = Record<string, string | undefined>;

const int = (value: string | undefined, fallback: number, max: number) => {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : undefined;
};

/** Ошибки — по имени переменной, без значений. */
export function loadBackupConfig(
  env: Env,
):
  | { ok: true; config: BackupConfig; warnings: string[] }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const value = (k: string) => env[k]?.trim() ?? "";
  const clinic = value("CLINIC_ID");
  if (!/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/.test(clinic))
    errors.push("CLINIC_ID: идентификатор клиники не задан");
  const dbPath = value("BOT_DB_PATH");
  if (!dbPath.startsWith("/"))
    errors.push("BOT_DB_PATH: нужен абсолютный путь к базе");

  let key: Buffer | undefined;
  try {
    key = parseBackupKey(env.BACKUP_KEY);
  } catch (error) {
    errors.push((error as Error).message);
  }
  if (
    key &&
    value("MEDICAL_DATA_KEY") &&
    value("MEDICAL_DATA_KEY") === value("BACKUP_KEY")
  )
    errors.push("BACKUP_KEY: должен отличаться от MEDICAL_DATA_KEY");

  const keep = int(env.BACKUP_KEEP, 30, 3650);
  if (keep === undefined)
    errors.push("BACKUP_KEEP: целое число копий (0 — не удалять)");
  const localKeep = int(env.BACKUP_LOCAL_KEEP, 3, 100);
  if (localKeep === undefined)
    errors.push("BACKUP_LOCAL_KEEP: целое число от 0 до 100");

  let storage: BackupStorage | undefined;
  const target = value("BACKUP_TARGET");
  if (target.startsWith("s3://")) {
    const [bucket, ...rest] = target.slice(5).split("/").filter(Boolean);
    const required = [
      "BACKUP_S3_ENDPOINT",
      "BACKUP_S3_REGION",
      "BACKUP_S3_ACCESS_KEY_ID",
      "BACKUP_S3_SECRET_ACCESS_KEY",
    ];
    for (const k of required) if (!value(k)) errors.push(`${k}: не задан`);
    if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,62}$/.test(bucket))
      errors.push("BACKUP_TARGET: s3://<бакет>/<каталог>");
    if (errors.length === 0) {
      try {
        storage = new S3Storage({
          endpoint: value("BACKUP_S3_ENDPOINT"),
          region: value("BACKUP_S3_REGION"),
          bucket: bucket!,
          // У каждой клиники — свой каталог в бакете.
          prefix: [...rest, clinic].join("/"),
          accessKeyId: value("BACKUP_S3_ACCESS_KEY_ID"),
          secretAccessKey: value("BACKUP_S3_SECRET_ACCESS_KEY"),
        });
      } catch (error) {
        errors.push((error as Error).message);
      }
    }
  } else if (target.startsWith("file:///")) {
    const dir = join(decodeURIComponent(new URL(target).pathname), clinic);
    storage = new DirStorage(dir);
    // Тот же диск, что и база, — это не независимое хранилище.
    const root = decodeURIComponent(new URL(target).pathname);
    if (
      dbPath &&
      existsSync(root) &&
      existsSync(dirname(dbPath)) &&
      statSync(root).dev === statSync(dirname(dbPath)).dev
    )
      warnings.push(
        "BACKUP_TARGET: каталог на том же диске, что и база, — это не резервирование, нужен внешний диск или хранилище",
      );
  } else {
    errors.push(
      "BACKUP_TARGET: s3://<бакет>/<каталог> или file:///<смонтированный внешний каталог>",
    );
  }

  if (errors.length > 0 || !key || !storage) return { ok: false, errors };
  const localDir = value("BACKUP_LOCAL_DIR") || undefined;
  if (keep === 0)
    warnings.push(
      "BACKUP_KEEP=0: копии не удаляются — срок хранения задайте правилом жизненного цикла в хранилище",
    );
  return {
    ok: true,
    warnings,
    config: {
      clinic,
      dbPath,
      key,
      storage,
      keep: keep!,
      localDir,
      localKeep: localKeep!,
      stagingDir: join(dirname(dbPath), "backup-tmp"),
      statusPath: join(dirname(dbPath), "backup-status.json"),
    },
  };
}
