import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  Clinic,
  Doctor,
  ScheduleException,
  Service,
  Specialty,
  Weekday,
  WorkingHours,
} from "@/bot/clinic/types";

/** Настройки клиники, которые меняет администратор. */
export type ClinicSettings = {
  name: string;
  address: string;
  phone: string;
  workingHours: string;
  route: string;
  about: string;
  visitTips: string[];
};

const SETTING_KEYS: Record<keyof ClinicSettings, string> = {
  name: "name",
  address: "address",
  phone: "phone",
  workingHours: "working_hours",
  route: "route",
  about: "about",
  visitTips: "visit_tips",
};

/** Врач в админ-панели: с отключёнными и счётчиком будущих записей. */
export type AdminDoctor = Doctor & { active: boolean; upcoming: number };

export type DoctorInput = {
  name: string;
  specialtyId: string;
  about: string;
  slotMinutes: number;
  priceRub: number | null;
};

export type ExceptionRow = ScheduleException & {
  id: number;
  reason: string;
};

type DoctorRow = {
  id: string;
  name: string;
  specialty_id: string;
  about: string;
  slot_minutes: number;
  price_rub: number | null;
  active: number;
};

type HoursRow = {
  doctor_id: string;
  weekday: number;
  from_time: string;
  to_time: string;
};

type ExceptionDbRow = {
  id: number;
  doctor_id: string | null;
  date: string;
  from_time: string | null;
  to_time: string | null;
  reason: string;
};

const toException = (r: ExceptionDbRow): ExceptionRow => ({
  id: r.id,
  date: r.date,
  reason: r.reason,
  ...(r.doctor_id ? { doctorId: r.doctor_id } : {}),
  ...(r.from_time && r.to_time ? { from: r.from_time, to: r.to_time } : {}),
});

/**
 * Справочники клиники в SQLite — единый источник для бота и админ-панели.
 * Бот читает их через `load()`: результат кэшируется до первого изменения
 * базы любым процессом (PRAGMA data_version) или этим же соединением.
 */
export class ClinicStore {
  private cache?: { key: string; clinic: Clinic };
  private writes = 0;

  constructor(private readonly db: DatabaseSync) {}

  /** Данные клиники для бота и расписания: без удалённых врачей. */
  load(): Clinic {
    const version = (
      this.db.prepare("PRAGMA data_version").get() as { data_version: number }
    ).data_version;
    const key = `${version}:${this.writes}`;
    if (this.cache?.key === key) return this.cache.clinic;
    const clinic = this.read();
    this.cache = { key, clinic };
    return clinic;
  }

  private read(): Clinic {
    const settings = this.getSettings();
    const timeZone = this.setting("time_zone") || "Europe/Moscow";
    const hours = this.db
      .prepare(
        "SELECT doctor_id, weekday, from_time, to_time FROM doctor_hours ORDER BY weekday, from_time",
      )
      .all() as HoursRow[];
    const byDoctor = new Map<string, WorkingHours[]>();
    for (const h of hours) {
      const list = byDoctor.get(h.doctor_id) ?? [];
      list.push({
        weekday: h.weekday as Weekday,
        from: h.from_time,
        to: h.to_time,
      });
      byDoctor.set(h.doctor_id, list);
    }
    const doctors = (
      this.db
        .prepare(
          "SELECT id, name, specialty_id, about, slot_minutes, price_rub, active FROM doctors WHERE deleted_at IS NULL ORDER BY sort, name",
        )
        .all() as DoctorRow[]
    ).map((d): Doctor => ({
      id: d.id,
      name: d.name,
      specialtyId: d.specialty_id,
      about: d.about,
      slotMinutes: d.slot_minutes,
      hours: byDoctor.get(d.id) ?? [],
      active: d.active === 1,
      ...(d.price_rub !== null ? { priceRub: d.price_rub } : {}),
    }));
    // Прошедшие исключения расписанию не нужны: берём с позавчерашнего дня.
    const since = new Date(Date.now() - 2 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const exceptions = this.listExceptions(since).map(
      ({ doctorId, date, from, to }): ScheduleException => ({
        date,
        ...(doctorId ? { doctorId } : {}),
        ...(from && to ? { from, to } : {}),
      }),
    );
    return {
      name: settings.name,
      address: settings.address,
      route: settings.route,
      workingHours: settings.workingHours,
      visitTips: settings.visitTips,
      timeZone,
      services: this.listServices(),
      specialties: this.listSpecialties(),
      doctors,
      exceptions,
      ...(settings.phone ? { phone: settings.phone } : {}),
      ...(settings.about ? { about: settings.about } : {}),
    };
  }

  private changed() {
    this.writes += 1;
  }

  private depth = 0;

  /** Несколько изменений — одной транзакцией (всё или ничего); вложенные — часть внешней. */
  transaction<T>(fn: () => T): T {
    if (this.depth > 0) {
      this.depth += 1;
      try {
        return fn();
      } finally {
        this.depth -= 1;
      }
    }
    this.db.exec("BEGIN IMMEDIATE");
    this.depth = 1;
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.depth = 0;
      this.changed();
    }
  }

  // --- Настройки -----------------------------------------------------------

  private setting(key: string): string {
    const row = this.db
      .prepare("SELECT value FROM clinic_settings WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? "";
  }

  getSettings(): ClinicSettings {
    return {
      name: this.setting("name"),
      address: this.setting("address"),
      phone: this.setting("phone"),
      workingHours: this.setting("working_hours"),
      route: this.setting("route"),
      about: this.setting("about"),
      visitTips: this.setting("visit_tips")
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean),
    };
  }

  updateSettings(settings: ClinicSettings): void {
    this.transaction(() => {
      const statement = this.db.prepare(
        "INSERT INTO clinic_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      );
      for (const [field, key] of Object.entries(SETTING_KEYS)) {
        const value = settings[field as keyof ClinicSettings];
        statement.run(key, Array.isArray(value) ? value.join("\n") : value);
      }
    });
  }

  // --- Направления и услуги -------------------------------------------------

  listSpecialties(): Specialty[] {
    return (
      this.db
        .prepare(
          "SELECT id, title, to_whom FROM specialties ORDER BY sort, title",
        )
        .all() as { id: string; title: string; to_whom: string }[]
    ).map((s) => ({ id: s.id, title: s.title, toWhom: s.to_whom }));
  }

  createSpecialty(title: string, toWhom: string): Specialty {
    const id = `sp-${randomBytes(4).toString("hex")}`;
    this.transaction(() => {
      const sort = (
        this.db
          .prepare("SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM specialties")
          .get() as { n: number }
      ).n;
      this.db
        .prepare(
          "INSERT INTO specialties (id, title, to_whom, sort) VALUES (?, ?, ?, ?)",
        )
        .run(id, title, toWhom, sort);
    });
    return { id, title, toWhom };
  }

  updateSpecialty(id: string, title: string, toWhom: string): boolean {
    return this.transaction(
      () =>
        Number(
          this.db
            .prepare(
              "UPDATE specialties SET title = ?, to_whom = ? WHERE id = ?",
            )
            .run(title, toWhom, id).changes,
        ) === 1,
    );
  }

  hasSpecialty(id: string): boolean {
    return Boolean(
      this.db.prepare("SELECT 1 FROM specialties WHERE id = ?").get(id),
    );
  }

  listServices(): Service[] {
    return (
      this.db
        .prepare(
          "SELECT title, specialty_id, price_rub FROM services ORDER BY sort, id",
        )
        .all() as {
        title: string;
        specialty_id: string | null;
        price_rub: number;
      }[]
    ).map((s) => ({
      title: s.title,
      specialtyId: s.specialty_id ?? "",
      priceRub: s.price_rub,
    }));
  }

  /** Список услуг заменяется целиком — так проще и безопаснее редактировать таблицу. */
  replaceServices(services: Service[]): void {
    this.transaction(() => {
      this.db.exec("DELETE FROM services");
      const insert = this.db.prepare(
        "INSERT INTO services (title, specialty_id, price_rub, sort) VALUES (?, ?, ?, ?)",
      );
      services.forEach((s, i) =>
        insert.run(s.title, s.specialtyId || null, s.priceRub, i),
      );
    });
  }

  // --- Врачи ---------------------------------------------------------------

  /** Врачи для панели: включая отключённых, без удалённых. */
  listDoctors(upcomingFrom: string): AdminDoctor[] {
    const clinic = this.load();
    const counts = new Map(
      (
        this.db
          .prepare(
            "SELECT doctor_id, COUNT(*) AS n FROM bookings WHERE status = 'confirmed' AND date >= ? GROUP BY doctor_id",
          )
          .all(upcomingFrom) as { doctor_id: string; n: number }[]
      ).map((r) => [r.doctor_id, r.n]),
    );
    return clinic.doctors.map((d) => ({
      ...d,
      active: d.active !== false,
      upcoming: counts.get(d.id) ?? 0,
    }));
  }

  /** Имя врача, даже удалённого, — для истории записей. */
  doctorNames(): Map<string, string> {
    return new Map(
      (
        this.db.prepare("SELECT id, name FROM doctors").all() as {
          id: string;
          name: string;
        }[]
      ).map((r) => [r.id, r.name]),
    );
  }

  createDoctor(input: DoctorInput, at: string): string {
    const id = `dr-${randomBytes(4).toString("hex")}`;
    this.transaction(() => {
      const sort = (
        this.db
          .prepare("SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM doctors")
          .get() as { n: number }
      ).n;
      this.db
        .prepare(
          "INSERT INTO doctors (id, name, specialty_id, about, slot_minutes, price_rub, active, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
        )
        .run(
          id,
          input.name,
          input.specialtyId,
          input.about,
          input.slotMinutes,
          input.priceRub,
          sort,
          at,
          at,
        );
    });
    return id;
  }

  updateDoctor(id: string, input: DoctorInput, at: string): boolean {
    return this.transaction(
      () =>
        Number(
          this.db
            .prepare(
              "UPDATE doctors SET name = ?, specialty_id = ?, about = ?, slot_minutes = ?, price_rub = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
            )
            .run(
              input.name,
              input.specialtyId,
              input.about,
              input.slotMinutes,
              input.priceRub,
              at,
              id,
            ).changes,
        ) === 1,
    );
  }

  setDoctorActive(id: string, active: boolean, at: string): boolean {
    return this.transaction(
      () =>
        Number(
          this.db
            .prepare(
              "UPDATE doctors SET active = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
            )
            .run(active ? 1 : 0, at, id).changes,
        ) === 1,
    );
  }

  /**
   * Удаление врача. С подтверждёнными будущими записями — запрещено: их нужно
   * перенести или отменить. Врач скрывается, но история записей сохраняет имя.
   */
  deleteDoctor(
    id: string,
    today: string,
    at: string,
  ): "ok" | "has_bookings" | "missing" {
    return this.transaction(() => {
      const exists = this.db
        .prepare("SELECT 1 FROM doctors WHERE id = ? AND deleted_at IS NULL")
        .get(id);
      if (!exists) return "missing";
      const upcoming = this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM bookings WHERE doctor_id = ? AND status = 'confirmed' AND date >= ?",
        )
        .get(id, today) as { n: number };
      if (upcoming.n > 0) return "has_bookings";
      this.db
        .prepare(
          "UPDATE doctors SET deleted_at = ?, active = 0, updated_at = ? WHERE id = ?",
        )
        .run(at, at, id);
      this.db.prepare("DELETE FROM doctor_hours WHERE doctor_id = ?").run(id);
      return "ok";
    });
  }

  // --- Расписание ----------------------------------------------------------

  /** Часы приёма врача заменяются целиком. */
  setHours(doctorId: string, hours: WorkingHours[]): void {
    this.transaction(() => {
      this.db
        .prepare("DELETE FROM doctor_hours WHERE doctor_id = ?")
        .run(doctorId);
      const insert = this.db.prepare(
        "INSERT INTO doctor_hours (doctor_id, weekday, from_time, to_time) VALUES (?, ?, ?, ?)",
      );
      for (const h of hours) insert.run(doctorId, h.weekday, h.from, h.to);
    });
  }

  listExceptions(fromDate: string, doctorId?: string): ExceptionRow[] {
    const rows = (
      doctorId
        ? this.db
            .prepare(
              "SELECT id, doctor_id, date, from_time, to_time, reason FROM schedule_exceptions WHERE date >= ? AND (doctor_id = ? OR doctor_id IS NULL) ORDER BY date, from_time",
            )
            .all(fromDate, doctorId)
        : this.db
            .prepare(
              "SELECT id, doctor_id, date, from_time, to_time, reason FROM schedule_exceptions WHERE date >= ? ORDER BY date, from_time",
            )
            .all(fromDate)
    ) as ExceptionDbRow[];
    return rows.map(toException);
  }

  addException(
    exception: ScheduleException & { reason: string },
    at: string,
  ): number {
    return this.transaction(() =>
      Number(
        this.db
          .prepare(
            "INSERT INTO schedule_exceptions (doctor_id, date, from_time, to_time, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(
            exception.doctorId ?? null,
            exception.date,
            exception.from ?? null,
            exception.to ?? null,
            exception.reason,
            at,
          ).lastInsertRowid,
      ),
    );
  }

  deleteException(id: number): boolean {
    return this.transaction(
      () =>
        Number(
          this.db
            .prepare("DELETE FROM schedule_exceptions WHERE id = ?")
            .run(id).changes,
        ) === 1,
    );
  }
}
