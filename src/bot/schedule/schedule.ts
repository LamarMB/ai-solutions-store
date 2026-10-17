import type { Clinic, Doctor, Specialty } from "@/bot/clinic/types";
import {
  addDays,
  fromMinutes,
  isDate,
  isTime,
  localDateTime,
  toMinutes,
  weekday,
} from "@/bot/schedule/time";
import type { Booking, BookingRepository } from "@/bot/storage/types";

export type BookResult =
  | { status: "ok"; booking: Booking }
  /** Слот заняли, пока пациент выбирал. */
  | { status: "taken" }
  /** Слота нет в расписании врача или он уже в прошлом. */
  | { status: "unavailable" }
  /** У пациента уже максимум активных записей. */
  | { status: "limit" };

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
};

export const DEFAULT_SCHEDULE_OPTIONS: ScheduleOptions = {
  horizonDays: 14,
  maxDays: 7,
  minLeadMinutes: 60,
  maxActiveBookings: 3,
};

/** Тестовое расписание: часы приёма врачей минус занятые записи и прошедшее время. */
export class ClinicSchedule implements ScheduleProvider {
  constructor(
    private readonly clinic: Clinic,
    private readonly repo: BookingRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly options: ScheduleOptions = DEFAULT_SCHEDULE_OPTIONS,
  ) {}

  listSpecialties() {
    // Только направления, у которых есть врачи.
    return this.clinic.specialties.filter((s) =>
      this.clinic.doctors.some((d) => d.specialtyId === s.id),
    );
  }

  listDoctors(specialtyId: string) {
    return this.clinic.doctors.filter((d) => d.specialtyId === specialtyId);
  }

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

  listFreeSlots(doctorId: string, date: string): string[] {
    const doctor = this.getDoctor(doctorId);
    if (!doctor || !isDate(date) || !this.inHorizon(date)) return [];
    const booked = new Set(this.repo.listBookedTimes(doctorId, date));
    return this.templateSlots(doctor, date).filter(
      (time) => !booked.has(time) && this.isFuture(date, time),
    );
  }

  book(
    peerId: number,
    doctorId: string,
    date: string,
    time: string,
  ): BookResult {
    const doctor = this.getDoctor(doctorId);
    if (
      !doctor ||
      !isDate(date) ||
      !isTime(time) ||
      !this.inHorizon(date) ||
      !this.templateSlots(doctor, date).includes(time) ||
      !this.isFuture(date, time)
    ) {
      return { status: "unavailable" };
    }
    if (this.listBookings(peerId).length >= this.options.maxActiveBookings) {
      return { status: "limit" };
    }
    const result = this.repo.insert({
      peerId,
      doctorId,
      date,
      time,
      createdAt: this.now().toISOString(),
    });
    return result.status === "ok" ? result : { status: "taken" };
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

  private today() {
    return localDateTime(this.now(), this.clinic.timeZone);
  }

  private inHorizon(date: string): boolean {
    const today = this.today().date;
    return date >= today && date < addDays(today, this.options.horizonDays);
  }

  private isFuture(date: string, time: string): boolean {
    const now = this.today();
    if (date > now.date) return true;
    if (date < now.date) return false;
    return toMinutes(time) >= toMinutes(now.time) + this.options.minLeadMinutes;
  }

  private templateSlots(doctor: Doctor, date: string): string[] {
    const day = weekday(date);
    const slots: string[] = [];
    for (const hours of doctor.hours.filter((h) => h.weekday === day)) {
      for (
        let m = toMinutes(hours.from);
        m + doctor.slotMinutes <= toMinutes(hours.to);
        m += doctor.slotMinutes
      ) {
        slots.push(fromMinutes(m));
      }
    }
    return slots;
  }
}
