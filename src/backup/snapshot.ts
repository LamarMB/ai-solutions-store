import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/**
 * Снимок работающей базы SQLite. `VACUUM INTO` выполняется в одной транзакции
 * чтения: копия согласованна и содержит всё подтверждённое, в том числе ещё не
 * перенесённое из журнала WAL; бот и панель продолжают писать. Незавершённые
 * транзакции в копию не попадают.
 */
export function snapshotDatabase(dbPath: string, target: string): void {
  if (!existsSync(dbPath))
    throw new Error("база клиники не найдена (BOT_DB_PATH)");
  if (existsSync(target)) throw new Error("файл снимка уже существует");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 10000");
    db.prepare("VACUUM INTO ?").run(target);
  } finally {
    db.close();
  }
}

export type DatabaseSummary = {
  /** PRAGMA user_version. */
  schema: number;
  /** Таблиц в базе. */
  tables: number;
  /** Записей на приём — для сверки после восстановления (не персональные данные). */
  bookings: number;
};

/**
 * Проверка файла базы: `PRAGMA integrity_check` и краткая сводка. Только
 * чтение; содержимое таблиц не выводится.
 */
export function verifyDatabase(path: string): DatabaseSummary {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch {
    throw new Error("файл не является исправной базой SQLite");
  }
  try {
    const check = db.prepare("PRAGMA integrity_check").all() as {
      integrity_check: string;
    }[];
    if (check.length !== 1 || check[0].integrity_check !== "ok")
      throw new Error("проверка целостности SQLite не пройдена");
    const schema = (
      db.prepare("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
    const tables = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .get() as { n: number }
    ).n;
    const hasBookings = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bookings'",
      )
      .get();
    const bookings = hasBookings
      ? (
          db.prepare("SELECT COUNT(*) AS n FROM bookings").get() as {
            n: number;
          }
        ).n
      : 0;
    return { schema, tables, bookings };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("проверка"))
      throw error;
    throw new Error("файл не является исправной базой SQLite");
  } finally {
    db.close();
  }
}
