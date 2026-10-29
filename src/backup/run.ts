import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { BackupConfig } from "@/backup/config";
import {
  BackupFormatError,
  decryptBackup,
  encryptBackup,
  sha256,
  type BackupHeader,
} from "@/backup/format";
import {
  snapshotDatabase,
  verifyDatabase,
  type DatabaseSummary,
} from "@/backup/snapshot";
import { StorageError } from "@/backup/storage";

/**
 * Резервная копия клиники: снимок → проверка → шифрование → внешнее хранилище
 * → проверка восстановлением из хранилища → удаление старых копий. Старые копии
 * удаляются только после того, как новая записана и проверена. Журнал — без
 * содержимого базы, ключей и адресов с подписью.
 */

export type Log = (message: string) => void;

/** Ошибка шага: понятное сообщение без секретов. */
export class BackupError extends Error {}

const STAMP_RE = /^\d{8}T\d{6}Z$/;
export const backupName = (clinic: string, at: Date) =>
  `demo-med-${clinic}-${at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "")}.dmbk`;

/** Копии этой клиники (чужие и посторонние файлы не трогаются), новые — первыми. */
export function ownBackups(clinic: string, names: readonly string[]): string[] {
  const prefix = `demo-med-${clinic}-`;
  return names
    .filter(
      (n) =>
        n.startsWith(prefix) &&
        n.endsWith(".dmbk") &&
        STAMP_RE.test(n.slice(prefix.length, -".dmbk".length)),
    )
    .sort()
    .reverse();
}

/** Сообщение ошибки для журнала: наши ошибки — как есть, прочие — только тип. */
function describe(step: string, error: unknown): string {
  if (
    error instanceof BackupError ||
    error instanceof BackupFormatError ||
    error instanceof StorageError
  )
    return `${step}: ${error.message}`;
  if (error instanceof Error && /^[А-Яа-яЁё]/.test(error.message))
    return `${step}: ${error.message}`;
  const code = (error as NodeJS.ErrnoException)?.code;
  return `${step}: ${code ?? (error instanceof Error ? error.name : "ошибка")}`;
}

async function step<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw new BackupError(describe(name, error));
  }
}

/** Атомарная запись файла: временный файл, fsync, переименование. */
function writeAtomic(path: string, data: Buffer) {
  const partial = `${path}.partial`;
  try {
    const fd = openSync(partial, "wx", 0o600);
    try {
      writeSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(partial, path);
  } catch (error) {
    rmSync(partial, { force: true });
    throw error;
  }
}

/** Один запуск на клинику: файл блокировки с PID, устаревший — снимается. */
function lock(dir: string): () => void {
  const path = join(dir, "backup.lock");
  try {
    writeFileSync(path, String(process.pid), { flag: "wx", mode: 0o600 });
  } catch {
    const pid = Number(readFileSync(path, "utf8"));
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch {
      alive = false;
    }
    if (alive)
      throw new BackupError(
        "резервное копирование этой клиники уже выполняется",
      );
    writeFileSync(path, String(process.pid), { mode: 0o600 });
  }
  return () => rmSync(path, { force: true });
}

/** Остатки прерванного запуска (снимки, расшифровки, .partial) удаляются. */
function cleanStaging(dir: string) {
  for (const name of readdirSync(dir))
    if (name !== "backup.lock") rmSync(join(dir, name), { force: true });
}

export type BackupResult = {
  name: string;
  size: number;
  summary: DatabaseSummary;
  /** Удалено старых копий во внешнем хранилище. */
  pruned: number;
  warnings: string[];
};

export async function runBackup(
  config: BackupConfig,
  {
    now = () => new Date(),
    log = () => {},
  }: { now?: () => Date; log?: Log } = {},
): Promise<BackupResult> {
  const startedAt = now();
  mkdirSync(config.stagingDir, { recursive: true, mode: 0o700 });
  const unlock = lock(config.stagingDir);
  const warnings: string[] = [];
  const name = backupName(config.clinic, startedAt);
  const snapshot = join(config.stagingDir, "snapshot.sqlite");
  const restored = join(config.stagingDir, "verify.sqlite");
  try {
    cleanStaging(config.stagingDir);
    log(
      `начало: клиника ${config.clinic}, хранилище — ${config.storage.label}`,
    );

    // 1. Согласованный снимок работающей базы и его проверка.
    const summary = await step("снимок базы", () => {
      snapshotDatabase(config.dbPath, snapshot);
      return verifyDatabase(snapshot);
    });
    // 2. Шифрование; незашифрованный снимок сразу удаляется.
    const encrypted = await step("шифрование", () => {
      try {
        return encryptBackup(readFileSync(snapshot), config.key, {
          clinic: config.clinic,
          createdAt: startedAt.toISOString(),
          schema: summary.schema,
        });
      } finally {
        rmSync(snapshot, { force: true });
      }
    });
    log(
      `снимок проверен: схема v${summary.schema}, таблиц ${summary.tables}, записей ${summary.bookings}; копия ${encrypted.length} байт`,
    );

    // 3. Зашифрованная копия на этом сервере — удобство, не резервирование.
    if (config.localDir) {
      const localDir = config.localDir;
      await step("локальная копия", () => {
        mkdirSync(localDir, { recursive: true, mode: 0o700 });
        writeAtomic(join(localDir, name), encrypted);
      });
    }

    // 4. Внешнее хранилище.
    await step("отправка", () => config.storage.put(name, encrypted));
    log(`отправлено: ${name}`);

    // 5. Проверка: копия из хранилища совпадает, расшифровывается и открывается.
    await step("проверка восстановления", async () => {
      const remote = await config.storage.get(name);
      if (sha256(remote) !== sha256(encrypted))
        throw new BackupError("копия в хранилище отличается от отправленной");
      const { database } = decryptBackup(remote, config.key, config.clinic);
      writeAtomic(restored, database);
      try {
        const check = verifyDatabase(restored);
        if (
          check.schema !== summary.schema ||
          check.bookings !== summary.bookings
        )
          throw new BackupError("восстановленная база не совпадает со снимком");
      } finally {
        rmSync(restored, { force: true });
      }
    });
    log(
      "проверено: копия из хранилища расшифрована, целостность SQLite в порядке",
    );

    // 6. Срок хранения — только после успешной новой копии.
    let pruned = 0;
    if (config.keep > 0) {
      try {
        const own = ownBackups(config.clinic, await config.storage.list());
        if (!own.includes(name))
          throw new BackupError("новая копия не видна в списке хранилища");
        for (const old of own.slice(config.keep)) {
          await config.storage.delete(old);
          pruned++;
        }
      } catch (error) {
        warnings.push(describe("удаление старых копий пропущено", error));
      }
    }
    if (config.localDir) {
      for (const old of ownBackups(
        config.clinic,
        readdirSync(config.localDir),
      ).slice(config.localKeep))
        rmSync(join(config.localDir, old), { force: true });
    }
    for (const w of warnings) log(`предупреждение: ${w}`);
    log(`готово: ${name}, удалено старых копий: ${pruned}`);
    writeStatus(config, {
      ok: true,
      at: startedAt.toISOString(),
      name,
      size: encrypted.length,
      schema: summary.schema,
      warnings,
    });
    return { name, size: encrypted.length, summary, pruned, warnings };
  } catch (error) {
    const message =
      error instanceof BackupError
        ? error.message
        : describe("копирование", error);
    log(`ошибка: ${message}`);
    writeStatus(config, {
      ok: false,
      at: startedAt.toISOString(),
      error: message,
    });
    throw error instanceof BackupError ? error : new BackupError(message);
  } finally {
    rmSync(snapshot, { force: true });
    rmSync(restored, { force: true });
    rmSync(`${restored}.partial`, { force: true });
    unlock();
  }
}

/** Состояние последнего запуска — для мониторинга (P0-9), без секретов. */
function writeStatus(config: BackupConfig, status: Record<string, unknown>) {
  try {
    writeFileSync(config.statusPath, `${JSON.stringify(status, null, 2)}\n`, {
      mode: 0o600,
    });
  } catch {
    // Статус — вспомогательный: его ошибка не отменяет копию.
  }
}

export async function listBackups(config: BackupConfig): Promise<string[]> {
  return ownBackups(
    config.clinic,
    await step("список", () => config.storage.list()),
  );
}

/**
 * Восстановление в НОВЫЙ файл: рабочая база и существующие файлы не
 * перезаписываются. Источник — копия из хранилища (`name`) или локальный файл.
 * Проверки: клиника, ключ, контрольная сумма, целостность SQLite.
 */
export async function restoreBackup(
  config: BackupConfig,
  source: { name: string } | { file: string },
  out: string,
): Promise<{ header: BackupHeader; summary: DatabaseSummary }> {
  const target = resolve(out);
  if (
    target === resolve(config.dbPath) ||
    target.startsWith(`${resolve(config.dbPath)}-`)
  )
    throw new BackupError(
      "восстановление поверх рабочей базы запрещено — укажите новый файл, замена — по инструкции",
    );
  if (existsSync(target))
    throw new BackupError(
      "файл восстановления уже существует — перезапись запрещена",
    );
  if (!existsSync(dirname(target)))
    throw new BackupError("каталог для восстановления не существует");
  const file = await step("получение копии", () =>
    "name" in source
      ? config.storage.get(source.name)
      : readFileSync(source.file),
  );
  const { header, database } = await step("расшифровка", () =>
    decryptBackup(file, config.key, config.clinic),
  );
  await step("запись", () => writeAtomic(target, database));
  try {
    const summary = await step("проверка", () => verifyDatabase(target));
    return { header, summary };
  } catch (error) {
    rmSync(target, { force: true });
    throw error;
  }
}
