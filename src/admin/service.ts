import type { z } from "zod";
import type { Weekday } from "@/bot/clinic/types";
import { ClinicSchedule } from "@/bot/schedule/schedule";
import { addDays, localDateTime } from "@/bot/schedule/time";
import type { SqliteStore } from "@/bot/storage/sqlite";
import type { Booking } from "@/bot/storage/types";
import {
  BookingCreateSchema,
  BookingFilterSchema,
  BookingUpdateSchema,
  describeZodError,
  DoctorPatchSchema,
  DoctorSchema,
  ExceptionSchema,
  HoursSchema,
  RequestUpdateSchema,
  SettingsSchema,
  SpecialtySchema,
} from "@/admin/schemas";
import { AdminError } from "@/admin/errors";
import { StaffService } from "@/admin/staff";
import type { AdminSession } from "@/bot/storage/admin-store";
import type { RedFlag } from "@/bot/conversation/safety";
import type { ComplaintArea } from "@/bot/conversation/triage";
import {
  MEDICAL_AREA_TITLES,
  RED_FLAG_TITLES,
} from "@/bot/conversation/medical-labels";

export { AdminError };

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const { message, fields } = describeZodError(result.error);
    throw new AdminError(400, message, fields);
  }
  return result.data;
}

/** Запись для панели: имена вместо id, VK ID пациента скрыт. */
export type BookingView = {
  id: number;
  date: string;
  time: string;
  status: NonNullable<Booking["status"]>;
  source: NonNullable<Booking["source"]>;
  note?: string;
  doctorId: string;
  doctorName: string;
  specialtyTitle: string;
  patient: string;
  createdAt: string;
};

/** Бот считается работающим, если опрашивал ВКонтакте последние 2 минуты. */
const BOT_ONLINE_MS = 2 * 60 * 1000;

const BOOK_ERRORS: Record<string, string> = {
  taken: "Это время уже занято. Выберите другое.",
  unavailable:
    "Этого времени нет в расписании врача (выходной, перерыв или прошедшее время).",
  missing: "Запись не найдена или уже отменена.",
};

/**
 * Операции админ-панели. Работают с той же базой и тем же расписанием
 * (ClinicSchedule), что и бот: запись из панели сразу закрывает слот для бота,
 * а изменения врачей, часов и цен бот видит со следующего сообщения.
 */
export class AdminService {
  readonly schedule: ClinicSchedule;
  readonly staff: StaffService;

  constructor(
    private readonly store: SqliteStore,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.schedule = new ClinicSchedule(() => store.clinic.load(), store, now);
    this.staff = new StaffService(store, now);
  }

  private get clinic() {
    return this.store.clinic.load();
  }

  today(): string {
    return localDateTime(this.now(), this.clinic.timeZone).date;
  }

  private audit(
    userId: number,
    action: string,
    entity: string,
    entityId: string | number,
  ) {
    this.store.admin.audit(
      userId,
      action,
      entity,
      entityId,
      this.now().toISOString(),
    );
  }

  private view(booking: Booking, names: Map<string, string>): BookingView {
    const clinic = this.clinic;
    const doctor = clinic.doctors.find((d) => d.id === booking.doctorId);
    const specialty = clinic.specialties.find(
      (s) => s.id === doctor?.specialtyId,
    );
    return {
      id: booking.id,
      date: booking.date,
      time: booking.time,
      status: booking.status ?? "confirmed",
      source: booking.source ?? "vk",
      ...(booking.note ? { note: booking.note } : {}),
      doctorId: booking.doctorId,
      doctorName:
        names.get(booking.doctorId) ?? `Удалённый врач (${booking.doctorId})`,
      specialtyTitle: specialty?.title ?? "",
      patient:
        booking.peerId > 0
          ? `ВКонтакте, id…${String(booking.peerId).slice(-3)}`
          : "Запись администратора",
      createdAt: booking.createdAt,
    };
  }

  // --- Главная -------------------------------------------------------------

  dashboard() {
    const today = this.today();
    const { time } = localDateTime(this.now(), this.clinic.timeZone);
    const weekEnd = addDays(today, 6);
    const names = this.store.clinic.doctorNames();
    const todayList = this.store
      .searchBookings({ from: today, to: today })
      .map((b) => this.view(b, names));
    const upcoming = this.store
      .searchBookings({
        from: today,
        to: addDays(today, 30),
        status: "confirmed",
        limit: 100,
      })
      .filter((b) => b.date > today || b.time >= time)
      .slice(0, 8)
      .map((b) => this.view(b, names));
    const week = this.store.countBookings(today, weekEnd);
    const sum = (filter: (r: (typeof week)[number]) => boolean) =>
      week.filter(filter).reduce((n, r) => n + r.count, 0);

    const statsFrom = addDays(today, -6);
    const rows = this.store.readStats(statsFrom);
    const stats: Record<string, number> = {};
    const messagesByDay: Record<string, number> = {};
    for (const row of rows) {
      stats[row.key] = (stats[row.key] ?? 0) + row.count;
      if (row.key === "messages_received") messagesByDay[row.day] = row.count;
    }
    const days = Array.from({ length: 7 }, (_, i) => addDays(statsFrom, i));

    const status = this.store.getBotStatus();
    const lastPoll = status.last_poll_at?.value;
    const online =
      lastPoll !== undefined &&
      this.now().getTime() - Date.parse(lastPoll) < BOT_ONLINE_MS;
    return {
      today,
      todayBookings: todayList,
      upcoming,
      week: {
        confirmed: sum((r) => r.status === "confirmed"),
        cancelled: sum((r) => r.status === "cancelled"),
        completed: sum((r) => r.status === "completed"),
        fromBot: sum((r) => r.source === "vk" && r.status !== "cancelled"),
        fromAdmin: sum((r) => r.source === "admin" && r.status !== "cancelled"),
        fromMiniApp: sum(
          (r) => r.source === "miniapp" && r.status !== "cancelled",
        ),
      },
      requests: {
        days: days.map((day) => ({ day, messages: messagesByDay[day] ?? 0 })),
        messages: stats.messages_received ?? 0,
        modelRequests: stats.model_requests ?? 0,
        savedRequests: stats.model_requests_saved ?? 0,
        offtopic:
          (stats.offtopic_rejected ?? 0) +
          (stats.role_change_rejected ?? 0) +
          (stats.model_out_of_scope ?? 0),
      },
      bot: {
        online,
        lastPollAt: lastPoll ?? null,
        startedAt: status.started_at?.value ?? null,
        stoppedAt: status.stopped_at?.value ?? null,
      },
    };
  }

  // --- Записи --------------------------------------------------------------

  listBookings(input: unknown): BookingView[] {
    const filter = parse(BookingFilterSchema, input);
    const today = this.today();
    const names = this.store.clinic.doctorNames();
    return this.store
      .searchBookings({
        from: filter.from ?? addDays(today, -30),
        to: filter.to ?? addDays(today, 90),
        doctorId: filter.doctorId,
        status: filter.status,
        source: filter.source,
        query: filter.query,
      })
      .map((b) => this.view(b, names));
  }

  createBooking(input: unknown, userId: number): BookingView {
    const data = parse(BookingCreateSchema, input);
    const result = this.schedule.book(0, data.doctorId, data.date, data.time, {
      admin: true,
      source: "admin",
      note: data.note || undefined,
    });
    if (result.status !== "ok")
      throw new AdminError(
        409,
        BOOK_ERRORS[result.status] ?? "Не удалось записать",
      );
    this.audit(userId, "create", "booking", result.booking.id);
    return this.view(result.booking, this.store.clinic.doctorNames());
  }

  updateBooking(id: number, input: unknown, userId: number): BookingView {
    const data = parse(BookingUpdateSchema, input);
    const booking = this.store.getBooking(id);
    if (!booking) throw new AdminError(404, BOOK_ERRORS.missing);
    if (data.action === "cancel") {
      if (!this.schedule.cancelById(id))
        throw new AdminError(
          409,
          "Отменить можно только подтверждённую запись.",
        );
    } else if (data.action === "complete") {
      if (!this.schedule.complete(id))
        throw new AdminError(
          409,
          "Завершить можно только подтверждённую запись.",
        );
    } else {
      const result = this.schedule.reschedule(
        id,
        data.doctorId,
        data.date,
        data.time,
      );
      if (result.status !== "ok")
        throw new AdminError(409, BOOK_ERRORS[result.status]);
    }
    // Согласие пациента дано врачу конкретной записи: при отмене или передаче
    // записи другому врачу оно прекращается, сведения удаляются.
    if (
      data.action === "cancel" ||
      (data.action === "reschedule" && data.doctorId !== booking.doctorId)
    )
      this.store.consents.revokeForBooking(id, this.now().toISOString());
    this.audit(userId, data.action, "booking", id);
    return this.view(
      this.store.getBooking(id)!,
      this.store.clinic.doctorNames(),
    );
  }

  /** Свободное время врача на дату (для записи и переноса из панели). */
  freeSlots(doctorId: string, date: string): string[] {
    if (!this.clinic.doctors.some((d) => d.id === doctorId))
      throw new AdminError(404, "Врач не найден.");
    return this.schedule.listFreeSlots(doctorId, date, { admin: true });
  }

  // --- Врачи и специальности -----------------------------------------------

  listDoctors() {
    return {
      doctors: this.store.clinic.listDoctors(this.today()),
      specialties: this.store.clinic.listSpecialties(),
    };
  }

  private checkSpecialty(id: string) {
    if (!this.store.clinic.hasSpecialty(id))
      throw new AdminError(400, "Выберите специальность из списка.", {
        specialtyId: "Выберите специальность из списка.",
      });
  }

  createDoctor(input: unknown, userId: number) {
    const data = parse(DoctorSchema, input);
    this.checkSpecialty(data.specialtyId);
    const id = this.store.clinic.createDoctor(data, this.now().toISOString());
    this.audit(userId, "create", "doctor", id);
    return this.doctor(id);
  }

  updateDoctor(id: string, input: unknown, userId: number) {
    this.doctor(id);
    const data = parse(DoctorPatchSchema, input);
    const at = this.now().toISOString();
    if ("active" in data) {
      this.store.clinic.setDoctorActive(id, data.active, at);
      this.audit(userId, data.active ? "enable" : "disable", "doctor", id);
    } else {
      this.checkSpecialty(data.specialtyId);
      this.store.clinic.updateDoctor(id, data, at);
      this.audit(userId, "update", "doctor", id);
    }
    return this.doctor(id);
  }

  deleteDoctor(id: string, userId: number) {
    const result = this.store.clinic.deleteDoctor(
      id,
      this.today(),
      this.now().toISOString(),
    );
    if (result === "missing") throw new AdminError(404, "Врач не найден.");
    if (result === "has_bookings")
      throw new AdminError(
        409,
        "У врача есть предстоящие записи. Перенесите или отмените их — или просто отключите врача.",
      );
    this.audit(userId, "delete", "doctor", id);
  }

  private doctor(id: string) {
    const doctor = this.store.clinic
      .listDoctors(this.today())
      .find((d) => d.id === id);
    if (!doctor) throw new AdminError(404, "Врач не найден.");
    return doctor;
  }

  createSpecialty(input: unknown, userId: number) {
    const data = parse(SpecialtySchema, input);
    const specialty = this.store.clinic.createSpecialty(
      data.title,
      data.toWhom,
    );
    this.audit(userId, "create", "specialty", specialty.id);
    return specialty;
  }

  updateSpecialty(id: string, input: unknown, userId: number) {
    const data = parse(SpecialtySchema, input);
    if (!this.store.clinic.updateSpecialty(id, data.title, data.toWhom))
      throw new AdminError(404, "Специальность не найдена.");
    this.audit(userId, "update", "specialty", id);
    return { id, ...data };
  }

  // --- Расписание ----------------------------------------------------------

  getSchedule(doctorId: string) {
    const doctor = this.doctor(doctorId);
    return {
      doctor,
      exceptions: this.store.clinic.listExceptions(this.today(), doctorId),
    };
  }

  setHours(doctorId: string, input: unknown, userId: number) {
    this.doctor(doctorId);
    const { hours } = parse(HoursSchema, input);
    this.store.clinic.setHours(
      doctorId,
      hours.map((h) => ({
        weekday: h.weekday as Weekday,
        from: h.from,
        to: h.to,
      })),
    );
    this.audit(userId, "update_hours", "doctor", doctorId);
    return this.getSchedule(doctorId);
  }

  /** Все выходные и перерывы клиники с сегодняшнего дня. */
  listExceptions() {
    return this.store.clinic.listExceptions(this.today());
  }

  addException(input: unknown, userId: number) {
    const data = parse(ExceptionSchema, input);
    if (data.date < this.today())
      throw new AdminError(400, "Нельзя менять расписание прошедших дней.");
    if (data.doctorId) this.doctor(data.doctorId);
    const id = this.store.clinic.addException(
      {
        date: data.date,
        reason: data.reason,
        ...(data.doctorId ? { doctorId: data.doctorId } : {}),
        ...(data.from && data.to ? { from: data.from, to: data.to } : {}),
      },
      this.now().toISOString(),
    );
    this.audit(userId, "create", "exception", id);
    // Подтверждённые записи в закрытое время не отменяются автоматически.
    const affected = this.store
      .searchBookings({
        from: data.date,
        to: data.date,
        status: "confirmed",
        doctorId: data.doctorId ?? undefined,
      })
      .filter(
        (b) => !data.from || (b.time >= data.from && b.time < data.to!),
      ).length;
    return { id, affectedBookings: affected };
  }

  deleteException(id: number, userId: number) {
    if (!this.store.clinic.deleteException(id))
      throw new AdminError(404, "Запись в расписании не найдена.");
    this.audit(userId, "delete", "exception", id);
  }

  // --- Врач: свои приёмы и сведения по согласию ---------------------------

  private requireDoctor(session: AdminSession): string {
    if (session.role !== "doctor" || !session.doctorId)
      throw new AdminError(403, "Раздел доступен только врачу.");
    return session.doctorId;
  }

  /**
   * Записи к врачу этой учётной записи — только организационные данные и
   * отметка, дал ли пациент согласие (без содержания сведений).
   */
  myBookings(session: AdminSession, input: unknown) {
    const doctorId = this.requireDoctor(session);
    const filter = parse(BookingFilterSchema, input);
    const today = this.today();
    const now = this.now().toISOString();
    const names = this.store.clinic.doctorNames();
    return {
      doctorName: names.get(doctorId) ?? doctorId,
      consentsEnabled: this.store.consents.enabled,
      bookings: this.store
        .searchBookings({
          from: filter.from ?? addDays(today, -7),
          to: filter.to ?? addDays(today, 30),
          doctorId,
          status: filter.status,
        })
        .map((b) => ({
          // Пометка администратора врачу не нужна: не расширяем круг читающих.
          ...this.view({ ...b, note: undefined }, names),
          medicalShared:
            b.status !== "cancelled" &&
            this.store.consents.hasActiveForDoctor(b.id, doctorId, now),
        })),
    };
  }

  /**
   * Сведения, которые пациент разрешил передать врачу этой записи. Выдаются,
   * только если: роль doctor, запись к его врачу расписания, запись не
   * отменена, есть действующее согласие именно для этого врача. Любая
   * попытка — в журнал доступа (без содержания сведений).
   */
  readMedical(session: AdminSession, bookingId: number) {
    const doctorId = this.requireDoctor(session);
    const at = this.now().toISOString();
    const log = (result: string, consentId: number | null = null) =>
      this.store.consents.logAccess({
        userId: session.userId,
        consentId,
        bookingId,
        action: "read_summary",
        result,
        at,
      });
    const booking = this.store.getBooking(bookingId);
    if (
      !booking ||
      booking.doctorId !== doctorId ||
      booking.status === "cancelled"
    ) {
      log("denied_not_own_booking");
      // Один ответ для «нет записи» и «чужая запись»: не раскрываем существование.
      throw new AdminError(404, "Запись не найдена среди ваших приёмов.");
    }
    const consent = this.store.consents.readForDoctor(bookingId, doctorId, at);
    if (!consent) {
      log("denied_no_consent");
      throw new AdminError(
        404,
        "Пациент не передавал сведения врачу по этой записи (или отозвал согласие).",
      );
    }
    log("granted", consent.consentId);
    const s = consent.summary;
    return {
      bookingId,
      source:
        "Со слов собеседника в сообщениях ВКонтакте. Личность не подтверждена. Это не медицинский документ.",
      area: MEDICAL_AREA_TITLES[s.area as ComplaintArea] ?? s.area,
      summary: s.summary,
      trauma: s.trauma ?? null,
      duration: s.duration ?? null,
      redFlags: s.redFlags.map((f) => RED_FLAG_TITLES[f as RedFlag] ?? f),
      redFlagsDenied: s.redFlagsDenied,
    };
  }

  /** Журнал доступа к медицинским сведениям и обращениям — только метаданные (owner). */
  medicalAccessLog() {
    const at = this.now().toISOString();
    return {
      consentsEnabled: this.store.consents.enabled,
      activeConsents: this.store.consents.countActive("doctor", at),
      entries: this.store.consents.listAccessLog(200),
      activeRequests: this.store.requests.countActive(at),
      requestEntries: this.store.requests.listAccessLog(200),
    };
  }

  // --- Обращения пациентов (роль admin) ------------------------------------

  /** Список без содержания: дата, статус, согласие, маска VK ID. */
  listRequests() {
    return {
      enabled: this.store.requests.enabled,
      requests: this.store.requests.list(this.now().toISOString()),
    };
  }

  /**
   * Текст обращения — только при действующем согласии и неизменном тексте.
   * Каждая попытка — в журнал (без содержания).
   */
  readRequest(session: AdminSession, id: number) {
    const at = this.now().toISOString();
    const result = this.store.requests.read(id, at);
    this.store.requests.logAccess({
      userId: session.userId,
      requestId: id,
      action: "read",
      result: result.ok ? "granted" : `denied_${result.reason}`,
      at,
    });
    if (!result.ok)
      throw new AdminError(
        result.reason === "missing" ? 404 : 410,
        {
          missing: "Обращение не найдено.",
          revoked:
            "Пациент отозвал согласие: текст обращения удалён и больше не доступен.",
          expired: "Срок хранения текста обращения истёк, текст удалён.",
          integrity:
            "Текст обращения не прошёл проверку целостности и не показывается.",
        }[result.reason],
      );
    return {
      ...result.meta,
      kind: "Дословно, как написал пациент и разрешил передать",
      text: result.text,
    };
  }

  updateRequest(session: AdminSession, id: number, input: unknown) {
    parse(RequestUpdateSchema, input);
    const at = this.now().toISOString();
    if (!this.store.requests.markDone(id, session.userId, at))
      throw new AdminError(404, "Обращение не найдено.");
    this.store.requests.logAccess({
      userId: session.userId,
      requestId: id,
      action: "done",
      result: "ok",
      at,
    });
    return this.store.requests.get(id, at);
  }

  // --- Настройки клиники ---------------------------------------------------

  getSettings() {
    return {
      settings: this.store.clinic.getSettings(),
      services: this.store.clinic.listServices(),
      specialties: this.store.clinic.listSpecialties(),
    };
  }

  updateSettings(input: unknown, userId: number) {
    const data = parse(SettingsSchema, input);
    for (const service of data.services) {
      if (
        service.specialtyId &&
        !this.store.clinic.hasSpecialty(service.specialtyId)
      )
        throw new AdminError(
          400,
          `Услуга «${service.title}»: неизвестная специальность.`,
        );
    }
    this.store.clinic.transaction(() => {
      this.store.clinic.updateSettings(data.settings);
      this.store.clinic.replaceServices(data.services);
    });
    this.audit(userId, "update", "settings", "clinic");
    return this.getSettings();
  }
}
