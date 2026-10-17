import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  Booking,
  BookingRepository,
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
`;

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
export class SqliteStore implements BookingRepository, SessionStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    this.db.exec(SCHEMA);
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

  close(): void {
    this.db.close();
  }
}
