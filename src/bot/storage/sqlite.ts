import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  Booking,
  BookingRepository,
  ChannelStore,
  NewBooking,
  SessionStore,
} from "@/bot/storage/types";

/** Код SQLite «нарушено ограничение уникальности» (SQLITE_CONSTRAINT_UNIQUE). */
const SQLITE_CONSTRAINT_UNIQUE = 2067;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  peer_id INTEGER NOT NULL,
  doctor_id TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  created_at TEXT NOT NULL,
  cancelled_at TEXT
);
-- Двойное бронирование невозможно: одна активная запись на слот врача.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_slot
  ON bookings (doctor_id, date, time) WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS bookings_peer ON bookings (peer_id, cancelled_at);

CREATE TABLE IF NOT EXISTS sessions (
  peer_id INTEGER PRIMARY KEY,
  state TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Пока администратор отвечает, бот молчит в диалоге.
CREATE TABLE IF NOT EXISTS pauses (
  peer_id INTEGER PRIMARY KEY,
  until TEXT NOT NULL
);

-- Обработанные события канала: повторно доставленное событие не обрабатывается.
CREATE TABLE IF NOT EXISTS processed_events (
  event_key TEXT PRIMARY KEY,
  processed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notices (
  peer_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (peer_id, kind)
);
`;

/**
 * Миграции схемы. Версия 2: индекс для удаления устаревших разговоров.
 * Формат JSON в sessions.state сменился на v2 (шаг записи + память разговора);
 * старые значения читаются кодом (parseSession), переписывать их не нужно.
 */
const MIGRATIONS = [
  SCHEMA,
  "CREATE INDEX IF NOT EXISTS sessions_updated ON sessions (updated_at);",
];

type BookingRow = {
  id: number;
  peer_id: number;
  doctor_id: string;
  date: string;
  time: string;
  created_at: string;
};

const toBooking = (row: BookingRow): Booking => ({
  id: row.id,
  peerId: row.peer_id,
  doctorId: row.doctor_id,
  date: row.date,
  time: row.time,
  createdAt: row.created_at,
});

/**
 * Локальное хранилище прототипа на встроенном в Node.js модуле node:sqlite
 * (без нативных зависимостей). `:memory:` — для тестов.
 */
export class SqliteStore
  implements BookingRepository, SessionStore, ChannelStore
{
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    this.migrate();
  }

  /** Версия схемы базы (PRAGMA user_version). */
  get schemaVersion(): number {
    const row = this.db.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    return row.user_version;
  }

  /**
   * Миграции по PRAGMA user_version. Каждая выполняется один раз, в транзакции.
   * Базы этапа Б1–Б5 (версия 0) уже содержат таблицы версии 1: CREATE … IF NOT EXISTS.
   */
  private migrate(): void {
    for (const [index, sql] of MIGRATIONS.entries()) {
      const version = index + 1;
      if (this.schemaVersion >= version) continue;
      this.db.exec("BEGIN");
      try {
        this.db.exec(sql);
        this.db.exec(`PRAGMA user_version = ${version}`);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
  }

  insert(
    booking: NewBooking,
  ): { status: "ok"; booking: Booking } | { status: "conflict" } {
    try {
      const result = this.db
        .prepare(
          "INSERT INTO bookings (peer_id, doctor_id, date, time, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          booking.peerId,
          booking.doctorId,
          booking.date,
          booking.time,
          booking.createdAt,
        );
      return {
        status: "ok",
        booking: { ...booking, id: Number(result.lastInsertRowid) },
      };
    } catch (error) {
      if (
        (error as { errcode?: number }).errcode === SQLITE_CONSTRAINT_UNIQUE
      ) {
        return { status: "conflict" };
      }
      throw error;
    }
  }

  listActiveByPeer(peerId: number, fromDate: string): Booking[] {
    const rows = this.db
      .prepare(
        "SELECT id, peer_id, doctor_id, date, time, created_at FROM bookings WHERE peer_id = ? AND cancelled_at IS NULL AND date >= ? ORDER BY date, time",
      )
      .all(peerId, fromDate) as BookingRow[];
    return rows.map(toBooking);
  }

  listBookedTimes(doctorId: string, date: string): string[] {
    const rows = this.db
      .prepare(
        "SELECT time FROM bookings WHERE doctor_id = ? AND date = ? AND cancelled_at IS NULL",
      )
      .all(doctorId, date) as { time: string }[];
    return rows.map((r) => r.time);
  }

  cancel(peerId: number, bookingId: number, cancelledAt: string): boolean {
    const result = this.db
      .prepare(
        "UPDATE bookings SET cancelled_at = ? WHERE id = ? AND peer_id = ? AND cancelled_at IS NULL",
      )
      .run(cancelledAt, bookingId, peerId);
    return Number(result.changes) === 1;
  }

  load(peerId: number) {
    const row = this.db
      .prepare("SELECT state, updated_at FROM sessions WHERE peer_id = ?")
      .get(peerId) as { state: string; updated_at: string } | undefined;
    if (!row) return undefined;
    try {
      return {
        state: JSON.parse(row.state) as unknown,
        updatedAt: row.updated_at,
      };
    } catch {
      return undefined;
    }
  }

  save(peerId: number, state: unknown, updatedAt: string): void {
    this.db
      .prepare(
        "INSERT INTO sessions (peer_id, state, updated_at) VALUES (?, ?, ?) ON CONFLICT(peer_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at",
      )
      .run(peerId, JSON.stringify(state), updatedAt);
  }

  delete(peerId: number): void {
    this.db.prepare("DELETE FROM sessions WHERE peer_id = ?").run(peerId);
  }

  pruneSessions(before: string): number {
    const result = this.db
      .prepare("DELETE FROM sessions WHERE updated_at < ?")
      .run(before);
    return Number(result.changes);
  }

  getPausedUntil(peerId: number): string | undefined {
    const row = this.db
      .prepare("SELECT until FROM pauses WHERE peer_id = ?")
      .get(peerId) as { until: string } | undefined;
    return row?.until;
  }

  setPausedUntil(peerId: number, until: string | undefined): void {
    if (until === undefined) {
      this.db.prepare("DELETE FROM pauses WHERE peer_id = ?").run(peerId);
      return;
    }
    this.db
      .prepare(
        "INSERT INTO pauses (peer_id, until) VALUES (?, ?) ON CONFLICT(peer_id) DO UPDATE SET until = excluded.until",
      )
      .run(peerId, until);
  }

  markEventProcessed(eventKey: string, at: string): boolean {
    const result = this.db
      .prepare(
        "INSERT OR IGNORE INTO processed_events (event_key, processed_at) VALUES (?, ?)",
      )
      .run(eventKey, at);
    return Number(result.changes) === 1;
  }

  pruneProcessedEvents(before: string): void {
    this.db
      .prepare("DELETE FROM processed_events WHERE processed_at < ?")
      .run(before);
  }

  getNoticeAt(peerId: number, kind: string): string | undefined {
    const row = this.db
      .prepare("SELECT sent_at FROM notices WHERE peer_id = ? AND kind = ?")
      .get(peerId, kind) as { sent_at: string } | undefined;
    return row?.sent_at;
  }

  setNoticeAt(peerId: number, kind: string, at: string): void {
    this.db
      .prepare(
        "INSERT INTO notices (peer_id, kind, sent_at) VALUES (?, ?, ?) ON CONFLICT(peer_id, kind) DO UPDATE SET sent_at = excluded.sent_at",
      )
      .run(peerId, kind, at);
  }

  close(): void {
    this.db.close();
  }
}
