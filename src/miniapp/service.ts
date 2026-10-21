import { z } from "zod";
import { isActiveDoctor } from "@/bot/clinic/types";
import { ClinicSchedule } from "@/bot/schedule/schedule";
import { addDays, isDate, isTime, localDateTime } from "@/bot/schedule/time";
import { photoUrl } from "@/bot/storage/photo-store";
import type { SqliteStore } from "@/bot/storage/sqlite";
import type { Booking } from "@/bot/storage/types";

/** Ошибка для пациента: HTTP-статус, код и понятный текст. */
export class MiniAppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const doctorId = z.string().trim().min(1).max(40);
const date = z.string().refine(isDate, "Дата в формате ГГГГ-ММ-ДД");
const time = z.string().refine(isTime, "Время в формате ЧЧ:ММ");

export const BookSchema = z.strictObject({ doctorId, date, time });
export const BookingActionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("cancel") }),
  z.strictObject({ action: z.literal("reschedule"), doctorId, date, time }),
]);

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new MiniAppError(
      400,
      "invalid",
      result.error.issues[0]?.message ?? "Проверьте данные.",
    );
  return result.data;
}

const BOOK_ERRORS = {
  taken: [409, "Это время только что заняли. Выберите другое."],
  unavailable: [
    409,
    "Это время больше недоступно: выберите другой день или время.",
  ],
  limit: [
    409,
    "У вас уже максимум активных записей (3). Отмените одну, чтобы записаться снова.",
  ],
  missing: [404, "Запись не найдена или уже отменена."],
} as const;

const failBooking = (status: keyof typeof BOOK_ERRORS): never => {
  const [code, message] = BOOK_ERRORS[status];
  throw new MiniAppError(code, status, message);
};

/**
 * Запись пациента для Mini App: только организационные данные. Пометка
 * администратора, источник, VK ID и любые медицинские сведения сюда не входят.
 */
export type PatientBooking = {
  id: number;
  date: string;
  time: string;
  status: "confirmed" | "completed" | "cancelled";
  /** Приём ещё впереди (подтверждённая запись на будущее время). */
  upcoming: boolean;
  doctorId: string;
  doctorName: string;
  specialty: string;
  priceRub: number | null;
  slotMinutes: number | null;
  /** Фото врача (адрес) или null — тогда монограмма. */
  doctorPhotoUrl: string | null;
};

/**
 * Операции Mini App. Работают с той же базой и тем же расписанием
 * (ClinicSchedule, правила пациента), что и бот: запись из Mini App сразу
 * видна в панели и в боте, занятый где угодно слот не предлагается.
 * Идентификатор пациента приходит только из проверенных параметров запуска.
 */
export class MiniAppService {
  readonly schedule: ClinicSchedule;

  constructor(
    private readonly store: SqliteStore,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.schedule = new ClinicSchedule(() => store.clinic.load(), store, now);
  }

  private get clinic() {
    return this.store.clinic.load();
  }

  private nowLocal() {
    return localDateTime(this.now(), this.clinic.timeZone);
  }

  /** Клиника, направления, врачи (только принимающие) и услуги — публичные данные. */
  clinicInfo(groupId?: number) {
    const clinic = this.clinic;
    const specialties = this.schedule.listSpecialties();
    const photos = this.store.photos.all();
    const doctors = clinic.doctors.filter(isActiveDoctor).map((d) => {
      const day = this.schedule.listAvailableDays(d.id)[0];
      const slot = day ? this.schedule.listFreeSlots(d.id, day)[0] : undefined;
      return {
        id: d.id,
        name: d.name,
        specialtyId: d.specialtyId,
        specialty:
          clinic.specialties.find((s) => s.id === d.specialtyId)?.title ?? "",
        about: d.about,
        priceRub: d.priceRub ?? null,
        slotMinutes: d.slotMinutes,
        nearest: day && slot ? { date: day, time: slot } : null,
        photoUrl: photoUrl(photos.get(d.id)),
        /** Демо-портрет, созданный ИИ: приложение подписывает его как демонстрационный. */
        photoIsDemo: photos.get(d.id)?.source === "demo_ai",
      };
    });
    return {
      name: clinic.name,
      address: clinic.address,
      phone: clinic.phone ?? null,
      workingHours: clinic.workingHours,
      route: clinic.route,
      about: clinic.about ?? null,
      visitTips: clinic.visitTips,
      today: this.nowLocal().date,
      specialties: specialties.map((s) => ({ id: s.id, title: s.title })),
      doctors,
      services: clinic.services.map((s) => ({
        title: s.title,
        priceRub: s.priceRub,
        // Для категорий и записи: направление услуги (если в клинике есть такие врачи).
        specialtyId: specialties.some((sp) => sp.id === s.specialtyId)
          ? s.specialtyId
          : null,
        specialty:
          clinic.specialties.find((sp) => sp.id === s.specialtyId)?.title ??
          null,
      })),
      // Ссылка на сообщения сообщества — основной канал разговора с ботом.
      messagesUrl: groupId ? `https://vk.com/im?sel=-${groupId}` : null,
    };
  }

  private activeDoctor(id: string) {
    const doctor = this.clinic.doctors.find((d) => d.id === id);
    if (!doctor || !isActiveDoctor(doctor))
      throw new MiniAppError(404, "doctor", "Врач не найден или не принимает.");
    return doctor;
  }

  /** Дни со свободным временем и свободное время на день — правила пациента. */
  days(doctorId: string): string[] {
    this.activeDoctor(doctorId);
    return this.schedule.listAvailableDays(doctorId);
  }

  slots(doctorId: string, day: string): string[] {
    this.activeDoctor(doctorId);
    if (!isDate(day)) throw new MiniAppError(400, "invalid", "Неверная дата.");
    return this.schedule.listFreeSlots(doctorId, day);
  }

  private view(b: Booking): PatientBooking {
    const clinic = this.clinic;
    const doctor = clinic.doctors.find((d) => d.id === b.doctorId);
    const now = this.nowLocal();
    const status = b.status ?? "confirmed";
    return {
      id: b.id,
      date: b.date,
      time: b.time,
      status,
      upcoming:
        status === "confirmed" &&
        (b.date > now.date || (b.date === now.date && b.time > now.time)),
      doctorId: b.doctorId,
      doctorName: doctor?.name ?? "Врач клиники",
      specialty:
        clinic.specialties.find((s) => s.id === doctor?.specialtyId)?.title ??
        "",
      priceRub: doctor?.priceRub ?? null,
      slotMinutes: doctor?.slotMinutes ?? null,
      doctorPhotoUrl: photoUrl(this.store.photos.meta(b.doctorId)),
    };
  }

  /** Записи пациента: предстоящие — по возрастанию, прошедшие — последние 180 дней. */
  myBookings(userId: number) {
    const today = this.nowLocal().date;
    const all = this.store
      .searchBookings({
        peerId: userId,
        from: addDays(today, -180),
        limit: 200,
      })
      .map((b) => this.view(b));
    return {
      upcoming: all.filter((b) => b.upcoming),
      past: all.filter((b) => !b.upcoming).reverse(),
    };
  }

  /** Своя запись; чужая и несуществующая — одинаковый ответ. */
  private own(userId: number, bookingId: number): Booking {
    const booking = this.store.getBooking(bookingId);
    if (!booking || booking.peerId !== userId) failBooking("missing");
    return booking!;
  }

  /**
   * Запись. Повтор того же запроса (двойное нажатие, обновление страницы,
   * повтор после обрыва сети) возвращает уже созданную запись, а не ошибку.
   */
  book(userId: number, input: unknown): PatientBooking & { repeated: boolean } {
    const data = parse(BookSchema, input);
    this.activeDoctor(data.doctorId);
    const existing = this.findSame(userId, data);
    if (existing) return { ...this.view(existing), repeated: true };
    const result = this.schedule.book(
      userId,
      data.doctorId,
      data.date,
      data.time,
      { source: "miniapp" },
    );
    if (result.status === "ok")
      return { ...this.view(result.booking), repeated: false };
    // Запрос мог успеть выполниться параллельно — тогда это тот же результат.
    const raced = this.findSame(userId, data);
    if (raced) return { ...this.view(raced), repeated: true };
    return failBooking(result.status);
  }

  private findSame(
    userId: number,
    slot: { doctorId: string; date: string; time: string },
  ): Booking | undefined {
    return this.schedule
      .listBookings(userId)
      .find(
        (b) =>
          b.doctorId === slot.doctorId &&
          b.date === slot.date &&
          b.time === slot.time,
      );
  }

  /** Отмена или перенос своей записи. Повторная отмена — тот же результат. */
  update(userId: number, bookingId: number, input: unknown): PatientBooking {
    const data = parse(BookingActionSchema, input);
    const booking = this.own(userId, bookingId);
    const at = this.now().toISOString();
    if (data.action === "cancel") {
      if (booking.status === "cancelled") return this.view(booking);
      if (!this.view(booking).upcoming)
        throw new MiniAppError(
          409,
          "past",
          "Прошедшую или завершённую запись отменить нельзя.",
        );
      if (!this.schedule.cancel(userId, bookingId)) failBooking("missing");
      // Как в боте и панели: согласие на передачу сведений врачу прекращается.
      this.store.consents.revokeForBooking(bookingId, at);
    } else {
      if (!this.view(booking).upcoming) failBooking("missing");
      this.activeDoctor(data.doctorId);
      const result = this.schedule.reschedule(
        bookingId,
        data.doctorId,
        data.date,
        data.time,
        { admin: false },
      );
      if (result.status !== "ok") failBooking(result.status);
      if (data.doctorId !== booking.doctorId)
        this.store.consents.revokeForBooking(bookingId, at);
    }
    return this.view(this.store.getBooking(bookingId)!);
  }
}
