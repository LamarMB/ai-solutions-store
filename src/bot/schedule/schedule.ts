import {
  isActiveDoctor,
  resolveClinic,
  type Clinic,
  type ClinicSource,
  type Doctor,
  type Specialty,
} from "@/bot/clinic/types";
import {
  addDays,
  fromMinutes,
  isDate,
  isTime,
  localDateTime,
  toMinutes,
  weekday,
} from "@/bot/schedule/time";
import type {
  Booking,
  BookingRepository,
  BookingSource,
} from "@/bot/storage/types";

export type BookResult =
  | { status: "ok"; booking: Booking }
  /** Слот заняли, пока пациент выбирал. */
  | { status: "taken" }
  /** Слота нет в расписании врача или он уже в прошлом. */
  | { status: "unavailable" }
  /** У пациента уже максимум активных записей. */
  | { status: "limit" };

export type MoveResult =
  | { status: "ok"; booking: Booking }
  | { status: "taken" }
  | { status: "unavailable" }
  /** Записи нет или она уже отменена/завершена. */
  | { status: "missing" };

/** Запись из админ-панели: дальше горизонт, без минимального запаса времени. */
export type BookOptions = {
  source?: BookingSource;
  note?: string;
  admin?: boolean;
};

/**
 * Расписание для диалога. Интерфейс не зависит от источника данных: сейчас —
 * тестовое расписание вымышленной клиники, позже — интеграция с МИС.
 */
export interface ScheduleProvider {
  listSpecialties(): readonly Specialty[];
  listDoctors(specialtyId: string): readonly Doctor[];
  getDoctor(doctorId: string): Doctor | undefined;
  /** Ближайшие дни, в которые у врача есть свободное время. */
  listAvailableDays(doctorId: string): string[];
  listFreeSlots(doctorId: string, date: string): string[];
  book(
    peerId: number,
    doctorId: string,
    date: string,
    time: string,
  ): BookResult;
  listBookings(peerId: number): Booking[];
  cancel(peerId: number, bookingId: number): boolean;
}

export type ScheduleOptions = {
  /** На сколько дней вперёд открыта запись. */
  horizonDays: number;
  /** Сколько дней со свободным временем показывать. */
  maxDays: number;
  /** Минимум минут до приёма при записи на сегодня. */
  minLeadMinutes: number;
  /** Максимум активных записей у одного собеседника. */
  maxActiveBookings: number;
  /** Горизонт записи для администратора. */
  adminHorizonDays: number;
};

export const DEFAULT_SCHEDULE_OPTIONS: ScheduleOptions = {
  horizonDays: 14,
  maxDays: 7,
  minLeadMinutes: 60,
  maxActiveBookings: 3,
  adminHorizonDays: 90,
};

/**
 * Расписание клиники: часы приёма врачей минус выходные, недоступные интервалы,
 * занятые записи и прошедшее время. Одна логика для бота и админ-панели;
 * данные клиники читаются из общей базы при каждом обращении.
 */
export class ClinicSchedule implements ScheduleProvider {
  private readonly options: ScheduleOptions;

  constructor(
    private readonly source: ClinicSource,
    private readonly repo: BookingRepository,
    private readonly now: () => Date = () => new Date(),
    options: Partial<ScheduleOptions> = {},
  ) {
    this.options = { ...DEFAULT_SCHEDULE_OPTIONS, ...options };
  }

  get clinic(): Clinic {
    return resolveClinic(this.source);
  }

  listSpecialties() {
    const clinic = this.clinic;
    // Только направления, у которых есть принимающие врачи.
    return clinic.specialties.filter((s) =>
      clinic.doctors.some((d) => d.specialtyId === s.id && isActiveDoctor(d)),
    );
  }

  listDoctors(specialtyId: string) {
    return this.clinic.doctors.filter(
      (d) => d.specialtyId === specialtyId && isActiveDoctor(d),
    );
  }

  /** Любой врач клиники, в том числе отключённый, — чтобы описать его записи. */
  getDoctor(doctorId: string) {
    return this.clinic.doctors.find((d) => d.id === doctorId);
  }

  listAvailableDays(doctorId: string): string[] {
    const today = this.today().date;
    const days: string[] = [];
    for (let i = 0; i < this.options.horizonDays; i++) {
      const date = addDays(today, i);
      if (this.listFreeSlots(doctorId, date).length > 0) days.push(date);
      if (days.length === this.options.maxDays) break;
    }
    return days;
  }

  listFreeSlots(
    doctorId: string,
    date: string,
    { admin = false }: { admin?: boolean } = {},
  ): string[] {
    const doctor = this.clinic.doctors.find((d) => d.id === doctorId);
    if (!doctor) return [];
    const booked = this.repo.listBookedTimes(doctorId, date).map(toMinutes);
    return this.scheduledSlots(doctorId, date, admin).filter(
      (time) => !overlaps(booked, time, doctor.slotMinutes),
    );
  }

  /**
   * Слоты по расписанию без учёта записей: часы приёма, выходные, перерывы,
   * горизонт и прошедшее время. Врач должен принимать пациентов.
   */
  private scheduledSlots(doctorId: string, date: string, admin: boolean) {
    const clinic = this.clinic;
    const doctor = clinic.doctors.find((d) => d.id === doctorId);
    if (!doctor || !isActiveDoctor(doctor) || !isDate(date)) return [];
    if (!this.inHorizon(date, admin)) return [];
    return this.templateSlots(doctor, date, clinic).filter((time) =>
      this.isFuture(date, time, admin),
    );
  }

  /** Свободен ли слот: «нет в расписании» и «занят» — разные ответы пациенту. */
  private slotState(
    doctorId: string,
    date: string,
    time: string,
    admin: boolean,
  ): "free" | "taken" | "unavailable" {
    if (
      !isTime(time) ||
      !this.scheduledSlots(doctorId, date, admin).includes(time)
    )
      return "unavailable";
    const doctor = this.clinic.doctors.find((d) => d.id === doctorId)!;
    const booked = this.repo.listBookedTimes(doctorId, date).map(toMinutes);
    return overlaps(booked, time, doctor.slotMinutes) ? "taken" : "free";
  }

  book(
    peerId: number,
    doctorId: string,
    date: string,
    time: string,
    options: BookOptions = {},
  ): BookResult {
    const state = this.slotState(doctorId, date, time, options.admin ?? false);
    if (state !== "free") return { status: state };
    if (
      !options.admin &&
      this.listBookings(peerId).length >= this.options.maxActiveBookings
    ) {
      return { status: "limit" };
    }
    // Двойное бронирование исключает уникальный индекс базы, даже если
    // бот и админ-панель записывают на один слот одновременно.
    const result = this.repo.insert({
      peerId,
      doctorId,
      date,
      time,
      createdAt: this.now().toISOString(),
      source: options.source ?? "vk",
      note: options.note,
    });
    return result.status === "ok" ? result : { status: "taken" };
  }

  /** Перенос записи (администратор): на свободный слот того же или другого врача. */
  reschedule(
    bookingId: number,
    doctorId: string,
    date: string,
    time: string,
  ): MoveResult {
    const current = this.repo.getBooking(bookingId);
    if (!current || current.status !== "confirmed")
      return { status: "missing" };
    if (
      current.doctorId === doctorId &&
      current.date === date &&
      current.time === time
    )
      return { status: "ok", booking: current };
    const state = this.slotState(doctorId, date, time, true);
    if (state !== "free") return { status: state };
    const result = this.repo.move(
      bookingId,
      doctorId,
      date,
      time,
      this.now().toISOString(),
    );
    if (result === "conflict") return { status: "taken" };
    if (result === "missing") return { status: "missing" };
    return { status: "ok", booking: this.repo.getBooking(bookingId)! };
  }

  listBookings(peerId: number): Booking[] {
    const { date, time } = this.today();
    // Прошедшие сегодняшние приёмы не показываем и не считаем.
    return this.repo
      .listActiveByPeer(peerId, date)
      .filter((b) => b.date > date || b.time > time);
  }

  cancel(peerId: number, bookingId: number): boolean {
    return this.repo.cancel(peerId, bookingId, this.now().toISOString());
  }

  /** Отмена любой подтверждённой записи (администратор). */
  cancelById(bookingId: number): boolean {
    return this.repo.cancelById(bookingId, this.now().toISOString());
  }

  /** Приём состоялся (администратор). */
  complete(bookingId: number): boolean {
    return this.repo.complete(bookingId, this.now().toISOString());
  }

  private today() {
    return localDateTime(this.now(), this.clinic.timeZone);
  }

  private inHorizon(date: string, admin: boolean): boolean {
    const today = this.today().date;
    const days = admin
      ? this.options.adminHorizonDays
      : this.options.horizonDays;
    return date >= today && date < addDays(today, days);
  }

  private isFuture(date: string, time: string, admin: boolean): boolean {
    const now = this.today();
    if (date > now.date) return true;
    if (date < now.date) return false;
    const lead = admin ? 0 : this.options.minLeadMinutes;
    return toMinutes(time) >= toMinutes(now.time) + lead;
  }

  /** Слоты по часам приёма за вычетом выходных и недоступных интервалов. */
  private templateSlots(
    doctor: Doctor,
    date: string,
    clinic: Clinic,
  ): string[] {
    const exceptions = (clinic.exceptions ?? []).filter(
      (e) => e.date === date && (!e.doctorId || e.doctorId === doctor.id),
    );
    if (exceptions.some((e) => !e.from || !e.to)) return [];
    const day = weekday(date);
    const slots: string[] = [];
    for (const hours of doctor.hours.filter((h) => h.weekday === day)) {
      for (
        let m = toMinutes(hours.from);
        m + doctor.slotMinutes <= toMinutes(hours.to);
        m += doctor.slotMinutes
      ) {
        const end = m + doctor.slotMinutes;
        // Слот недоступен, если пересекается с перерывом.
        const blocked = exceptions.some(
          (e) => m < toMinutes(e.to!) && end > toMinutes(e.from!),
        );
        if (!blocked) slots.push(fromMinutes(m));
      }
    }
    return slots;
  }
}

/**
 * Слот пересекается с записью: если администратор сменил длительность приёма,
 * старые записи не накладываются на новые слоты.
 */
function overlaps(booked: number[], time: string, slotMinutes: number) {
  const start = toMinutes(time);
  return booked.some((b) => Math.abs(b - start) < slotMinutes);
}
