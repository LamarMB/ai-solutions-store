import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fictionalClinic } from "@/bot/clinic/fictional-clinic";
import type { Clinic } from "@/bot/clinic/types";
import { AdminStore } from "@/bot/storage/admin-store";
import { ClinicStore } from "@/bot/storage/clinic-store";
import { ConsentStore } from "@/bot/storage/consent-store";
import { isEncrypted, type MedicalCipher } from "@/bot/storage/medical-crypto";
import type {
  Booking,
  BookingRepository,
  BookingSource,
  BookingStatus,
  ChannelStore,
  NewBooking,
  SessionStore,
  StatsStore,
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

/** Версия 4: справочники клиники в базе вместо кода, статусы и источник записей. */
const CLINIC_SCHEMA = `
CREATE TABLE IF NOT EXISTS clinic_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS specialties (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  to_whom TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS doctors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  specialty_id TEXT NOT NULL,
  about TEXT NOT NULL DEFAULT '',
  slot_minutes INTEGER NOT NULL,
  price_rub INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS doctor_hours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id TEXT NOT NULL,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  from_time TEXT NOT NULL,
  to_time TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS doctor_hours_doctor ON doctor_hours (doctor_id);
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  specialty_id TEXT,
  price_rub INTEGER NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
-- Выходные и недоступные интервалы: без врача — для всей клиники, без времени — весь день.
CREATE TABLE IF NOT EXISTS schedule_exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id TEXT,
  date TEXT NOT NULL,
  from_time TEXT,
  to_time TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS schedule_exceptions_date ON schedule_exceptions (date);
ALTER TABLE bookings ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed';
ALTER TABLE bookings ADD COLUMN source TEXT NOT NULL DEFAULT 'vk';
ALTER TABLE bookings ADD COLUMN note TEXT;
ALTER TABLE bookings ADD COLUMN updated_at TEXT;
ALTER TABLE bookings ADD COLUMN completed_at TEXT;
UPDATE bookings SET status = 'cancelled' WHERE cancelled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS bookings_date ON bookings (date, time);
`;

/** Версия 5: администраторы, сессии панели, журнал действий, состояние бота. */
const ADMIN_SCHEMA = `
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  disabled_at TEXT
);
-- Хранится только SHA-256 токена сессии: утечка базы не даёт войти.
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_sessions_user ON admin_sessions (user_id);
-- Журнал действий администраторов: что и с какой сущностью, без персональных данных.
CREATE TABLE IF NOT EXISTS admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT
);
CREATE TABLE IF NOT EXISTS bot_status (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

/** Начальные данные клиники — прежняя вымышленная клиника из кода. */
export function seedClinic(db: DatabaseSync, clinic: Clinic, at: string) {
  const hasData = db.prepare("SELECT COUNT(*) AS n FROM specialties").get() as {
    n: number;
  };
  if (hasData.n > 0) return;
  const setting = db.prepare(
    "INSERT OR REPLACE INTO clinic_settings (key, value) VALUES (?, ?)",
  );
  for (const [key, value] of Object.entries({
    name: clinic.name,
    address: clinic.address,
    phone: clinic.phone ?? "",
    working_hours: clinic.workingHours,
    route: clinic.route,
    about: clinic.about ?? "",
    visit_tips: clinic.visitTips.join("\n"),
    time_zone: clinic.timeZone,
  }))
    setting.run(key, value);
  const specialty = db.prepare(
    "INSERT INTO specialties (id, title, to_whom, sort) VALUES (?, ?, ?, ?)",
  );
  clinic.specialties.forEach((s, i) =>
    specialty.run(s.id, s.title, s.toWhom, i),
  );
  const doctor = db.prepare(
    "INSERT INTO doctors (id, name, specialty_id, about, slot_minutes, price_rub, active, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
  );
  const hours = db.prepare(
    "INSERT INTO doctor_hours (doctor_id, weekday, from_time, to_time) VALUES (?, ?, ?, ?)",
  );
  clinic.doctors.forEach((d, i) => {
    doctor.run(
      d.id,
      d.name,
      d.specialtyId,
      d.about,
      d.slotMinutes,
      d.priceRub ?? null,
      i,
      at,
      at,
    );
    for (const h of d.hours) hours.run(d.id, h.weekday, h.from, h.to);
  });
  const service = db.prepare(
    "INSERT INTO services (title, specialty_id, price_rub, sort) VALUES (?, ?, ?, ?)",
  );
  clinic.services.forEach((s, i) =>
    service.run(s.title, s.specialtyId, s.priceRub, i),
  );
}

/**
 * Версия 6: роли сотрудников и медицинская конфиденциальность.
 * Существующие учётные записи панели получают роль owner (сохраняют доступ к
 * сотрудникам и настройкам; медицинских данных роль не открывает). Новые записи
 * по умолчанию — admin: роль всегда задаётся явно.
 */
const PRIVACY_SCHEMA = `
ALTER TABLE admin_users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'
  CHECK (role IN ('owner', 'admin', 'doctor'));
ALTER TABLE admin_users ADD COLUMN doctor_id TEXT;
UPDATE admin_users SET role = 'owner';
-- Учётная запись врача связана ровно с одним врачом расписания.
CREATE UNIQUE INDEX IF NOT EXISTS admin_users_doctor
  ON admin_users (doctor_id) WHERE doctor_id IS NOT NULL;
-- Приглашения сотрудников: в базе только SHA-256 одноразового токена.
CREATE TABLE IF NOT EXISTS staff_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  login TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'doctor')),
  doctor_id TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT
);
-- Согласие пациента на передачу строго определённых сведений конкретному
-- получателю с конкретной целью. Нет строки — нет доступа. payload зашифрован.
CREATE TABLE IF NOT EXISTS disclosure_consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  peer_id INTEGER NOT NULL,
  recipient_role TEXT NOT NULL CHECK (recipient_role IN ('doctor', 'admin')),
  recipient_doctor_id TEXT,
  scope TEXT NOT NULL,
  purpose TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL CHECK (status IN ('granted', 'revoked', 'expired')),
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS disclosure_consents_booking ON disclosure_consents (booking_id);
CREATE INDEX IF NOT EXISTS disclosure_consents_peer ON disclosure_consents (peer_id);
-- Журнал доступа к медицинским сведениям: кто, когда, к какой записи (без содержания).
CREATE TABLE IF NOT EXISTS medical_access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  consent_id INTEGER,
  booking_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  result TEXT NOT NULL
);
`;

type Migration = string | ((db: DatabaseSync) => void);

/**
 * Миграции схемы (номер версии — позиция в списке + 1):
 * 1 — исходные таблицы; 2 — индекс для удаления устаревших разговоров;
 * 3 — счётчики stats; 4 — справочники клиники, статусы и источник записей
 * (с начальными данными прежней вымышленной клиники); 5 — администраторы;
 * 6 — роли сотрудников, приглашения, согласия пациентов, журнал медицинского доступа.
 * Формат JSON в sessions.state сменился на v2 (шаг записи + память разговора);
 * старые значения читаются кодом (parseSession), переписывать их не нужно.
 */
const MIGRATIONS: Migration[] = [
  SCHEMA,
  "CREATE INDEX IF NOT EXISTS sessions_updated ON sessions (updated_at);",
  // Версия 3: дневные счётчики фильтров и обращений к модели (без текста).
  `CREATE TABLE IF NOT EXISTS stats (
    day TEXT NOT NULL,
    key TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, key)
  );`,
  (db) => {
    db.exec(CLINIC_SCHEMA);
    seedClinic(db, fictionalClinic, new Date().toISOString());
  },
  ADMIN_SCHEMA,
  PRIVACY_SCHEMA,
];

/** Последняя версия схемы. */
export const SCHEMA_VERSION = MIGRATIONS.length;

type BookingRow = {
  id: number;
  peer_id: number;
  doctor_id: string;
  date: string;
  time: string;
  created_at: string;
  status: BookingStatus;
  source: BookingSource;
  note: string | null;
};

const BOOKING_COLUMNS =
  "id, peer_id, doctor_id, date, time, created_at, status, source, note";

const toBooking = (row: BookingRow): Booking => ({
  id: row.id,
  peerId: row.peer_id,
  doctorId: row.doctor_id,
  date: row.date,
  time: row.time,
  createdAt: row.created_at,
  status: row.status,
  source: row.source,
  ...(row.note ? { note: row.note } : {}),
});

/** Фильтр списка записей в админ-панели. */
export type BookingFilter = {
  from?: string;
  to?: string;
  doctorId?: string;
  /** Записи одного пациента (VK ID) — для Mini App. */
  peerId?: number;
  status?: BookingStatus;
  source?: BookingSource;
  /** Номер записи или текст пометки. */
  query?: string;
  limit?: number;
};

/**
 * Локальное хранилище прототипа на встроенном в Node.js модуле node:sqlite
 * (без нативных зависимостей). `:memory:` — для тестов.
 */
export class SqliteStore
  implements BookingRepository, SessionStore, ChannelStore, StatsStore
{
  private readonly db: DatabaseSync;
  /** Справочники клиники: врачи, расписание, услуги, настройки. */
  readonly clinic: ClinicStore;
  /** Администраторы, сессии и журнал панели. */
  readonly admin: AdminStore;

  /** Согласия пациентов на передачу сведений и журнал доступа к ним. */
  readonly consents: ConsentStore;
  private readonly cipher?: MedicalCipher;

  /**
   * `cipher` — ключ MEDICAL_DATA_KEY: память разговоров (жалобы, ответы,
   * реплики) хранится зашифрованной; без ключа передача сведений врачу выключена.
   */
  constructor(path: string, { cipher }: { cipher?: MedicalCipher } = {}) {
    this.cipher = cipher;
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    // Бот и панель — разные процессы с одной базой: WAL и ожидание блокировки.
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.migrate();
    this.clinic = new ClinicStore(this.db);
    this.admin = new AdminStore(this.db);
    this.consents = new ConsentStore(this.db, cipher);
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
    for (const [index, migration] of MIGRATIONS.entries()) {
      const version = index + 1;
      if (this.schemaVersion >= version) continue;
      // IMMEDIATE: второй процесс ждёт, а не применяет ту же миграцию параллельно.
      this.db.exec("BEGIN IMMEDIATE");
      try {
        if (this.schemaVersion >= version) {
          this.db.exec("COMMIT");
          continue;
        }
        if (typeof migration === "string") this.db.exec(migration);
        else migration(this.db);
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
          "INSERT INTO bookings (peer_id, doctor_id, date, time, created_at, source, note) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          booking.peerId,
          booking.doctorId,
          booking.date,
          booking.time,
          booking.createdAt,
          booking.source ?? "vk",
          booking.note ?? null,
        );
      return {
        status: "ok",
        booking: this.getBooking(Number(result.lastInsertRowid))!,
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
        `SELECT ${BOOKING_COLUMNS} FROM bookings WHERE peer_id = ? AND status = 'confirmed' AND date >= ? ORDER BY date, time`,
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
        "UPDATE bookings SET cancelled_at = ?, updated_at = ?, status = 'cancelled' WHERE id = ? AND peer_id = ? AND status = 'confirmed'",
      )
      .run(cancelledAt, cancelledAt, bookingId, peerId);
    return Number(result.changes) === 1;
  }

  cancelById(bookingId: number, cancelledAt: string): boolean {
    const result = this.db
      .prepare(
        "UPDATE bookings SET cancelled_at = ?, updated_at = ?, status = 'cancelled' WHERE id = ? AND status = 'confirmed'",
      )
      .run(cancelledAt, cancelledAt, bookingId);
    return Number(result.changes) === 1;
  }

  complete(bookingId: number, completedAt: string): boolean {
    const result = this.db
      .prepare(
        "UPDATE bookings SET completed_at = ?, updated_at = ?, status = 'completed' WHERE id = ? AND status = 'confirmed'",
      )
      .run(completedAt, completedAt, bookingId);
    return Number(result.changes) === 1;
  }

  move(
    bookingId: number,
    doctorId: string,
    date: string,
    time: string,
    updatedAt: string,
  ): "ok" | "conflict" | "missing" {
    try {
      const result = this.db
        .prepare(
          "UPDATE bookings SET doctor_id = ?, date = ?, time = ?, updated_at = ? WHERE id = ? AND status = 'confirmed'",
        )
        .run(doctorId, date, time, updatedAt, bookingId);
      return Number(result.changes) === 1 ? "ok" : "missing";
    } catch (error) {
      if ((error as { errcode?: number }).errcode === SQLITE_CONSTRAINT_UNIQUE)
        return "conflict";
      throw error;
    }
  }

  getBooking(bookingId: number): Booking | undefined {
    const row = this.db
      .prepare(`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = ?`)
      .get(bookingId) as BookingRow | undefined;
    return row ? toBooking(row) : undefined;
  }

  /** Список записей для админ-панели (по дате и времени). */
  searchBookings(filter: BookingFilter = {}): Booking[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.from) {
      where.push("date >= ?");
      params.push(filter.from);
    }
    if (filter.to) {
      where.push("date <= ?");
      params.push(filter.to);
    }
    if (filter.doctorId) {
      where.push("doctor_id = ?");
      params.push(filter.doctorId);
    }
    if (filter.peerId !== undefined) {
      where.push("peer_id = ?");
      params.push(filter.peerId);
    }
    if (filter.status) {
      where.push("status = ?");
      params.push(filter.status);
    }
    if (filter.source) {
      where.push("source = ?");
      params.push(filter.source);
    }
    const query = filter.query?.trim();
    if (query) {
      const id = Number(query.replace(/^№/, ""));
      if (Number.isInteger(id) && id > 0) {
        where.push("id = ?");
        params.push(id);
      } else {
        where.push("note LIKE ? ESCAPE '\\'");
        params.push(`%${query.replace(/[\\%_]/g, "\\$&")}%`);
      }
    }
    const rows = this.db
      .prepare(
        `SELECT ${BOOKING_COLUMNS} FROM bookings ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY date, time, id LIMIT ?`,
      )
      .all(...params, Math.min(filter.limit ?? 500, 2000)) as BookingRow[];
    return rows.map(toBooking);
  }

  /** Количество записей по статусу и источнику за период (для главной панели). */
  countBookings(from: string, to: string) {
    return this.db
      .prepare(
        "SELECT status, source, COUNT(*) AS count FROM bookings WHERE date >= ? AND date <= ? GROUP BY status, source",
      )
      .all(from, to) as {
      status: BookingStatus;
      source: BookingSource;
      count: number;
    }[];
  }

  /** Активные будущие записи врача — удаление врача с ними запрещено. */
  countUpcomingByDoctor(doctorId: string, fromDate: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM bookings WHERE doctor_id = ? AND status = 'confirmed' AND date >= ?",
      )
      .get(doctorId, fromDate) as { n: number };
    return row.n;
  }

  /** Отметка процесса бота: панель показывает, работает ли он. */
  setBotStatus(key: string, value: string, at: string): void {
    this.db
      .prepare(
        "INSERT INTO bot_status (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .run(key, value, at);
  }

  getBotStatus(): Record<string, { value: string; updatedAt: string }> {
    const rows = this.db
      .prepare("SELECT key, value, updated_at FROM bot_status")
      .all() as { key: string; value: string; updated_at: string }[];
    return Object.fromEntries(
      rows.map((r) => [r.key, { value: r.value, updatedAt: r.updated_at }]),
    );
  }

  load(peerId: number) {
    const row = this.db
      .prepare("SELECT state, updated_at FROM sessions WHERE peer_id = ?")
      .get(peerId) as { state: string; updated_at: string } | undefined;
    if (!row) return undefined;
    // Зашифрованное без ключа (или чужим ключом) не читается: разговор начнётся заново.
    const text = isEncrypted(row.state)
      ? this.cipher?.decrypt(row.state, `session:${peerId}`)
      : row.state;
    if (text === undefined) return undefined;
    try {
      return { state: JSON.parse(text) as unknown, updatedAt: row.updated_at };
    } catch {
      return undefined;
    }
  }

  /** Хранится ли память разговоров зашифрованной. */
  get encryptsSessions(): boolean {
    return this.cipher !== undefined;
  }

  save(peerId: number, state: unknown, updatedAt: string): void {
    this.db
      .prepare(
        "INSERT INTO sessions (peer_id, state, updated_at) VALUES (?, ?, ?) ON CONFLICT(peer_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at",
      )
      .run(
        peerId,
        this.cipher
          ? this.cipher.encrypt(JSON.stringify(state), `session:${peerId}`)
          : JSON.stringify(state),
        updatedAt,
      );
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

  incrementStat(day: string, key: string, by = 1): void {
    this.db
      .prepare(
        "INSERT INTO stats (day, key, count) VALUES (?, ?, ?) ON CONFLICT(day, key) DO UPDATE SET count = count + excluded.count",
      )
      .run(day, key, by);
  }

  readStats(fromDay: string): { day: string; key: string; count: number }[] {
    return this.db
      .prepare(
        "SELECT day, key, count FROM stats WHERE day >= ? ORDER BY day, key",
      )
      .all(fromDay) as { day: string; key: string; count: number }[];
  }

  close(): void {
    this.db.close();
  }
}
