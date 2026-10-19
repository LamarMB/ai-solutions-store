/** Статус записи: подтверждена, приём состоялся, отменена. */
export const BOOKING_STATUSES = [
  "confirmed",
  "completed",
  "cancelled",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Откуда запись: бот ВКонтакте, админ-панель или VK Mini App. */
export type BookingSource = "vk" | "admin" | "miniapp";

/** Запись на приём. Только вымышленные данные: врач, слот и id диалога ВКонтакте. */
export type Booking = {
  id: number;
  /** Идентификатор собеседника (peer_id ВКонтакте); 0 — запись из админ-панели. */
  peerId: number;
  doctorId: string;
  /** Дата «ГГГГ-ММ-ДД» и время «ЧЧ:ММ» — локальные для клиники. */
  date: string;
  time: string;
  createdAt: string;
  status?: BookingStatus;
  source?: BookingSource;
  /** Пометка администратора (демо: без реальных персональных данных). */
  note?: string;
};

export type NewBooking = Omit<Booking, "id" | "status">;

/**
 * Хранилище записей. Защита от двойного бронирования — на уровне хранилища:
 * активная запись на один и тот же слот врача может быть только одна.
 */
export interface BookingRepository {
  /** `conflict` — слот уже занят другой активной записью. */
  insert(
    booking: NewBooking,
  ): { status: "ok"; booking: Booking } | { status: "conflict" };
  /** Подтверждённые записи собеседника, начиная с указанной даты, по возрастанию времени. */
  listActiveByPeer(peerId: number, fromDate: string): Booking[];
  /** Занятые слоты врача на дату (только время). */
  listBookedTimes(doctorId: string, date: string): string[];
  /** Отменяет подтверждённую запись собеседника; false — записи нет или она чужая. */
  cancel(peerId: number, bookingId: number, cancelledAt: string): boolean;
  /** Отмена любой подтверждённой записи (администратор). */
  cancelById(bookingId: number, cancelledAt: string): boolean;
  /** Отметка «приём состоялся». */
  complete(bookingId: number, completedAt: string): boolean;
  /** Перенос подтверждённой записи; `conflict` — новый слот занят. */
  move(
    bookingId: number,
    doctorId: string,
    date: string,
    time: string,
    updatedAt: string,
  ): "ok" | "conflict" | "missing";
  getBooking(bookingId: number): Booking | undefined;
}

/** Состояние диалога по собеседнику — чтобы разговор переживал перезапуск. */
export interface SessionStore {
  load(peerId: number): { state: unknown; updatedAt: string } | undefined;
  save(peerId: number, state: unknown, updatedAt: string): void;
  /** Удаляет разговор собеседника (команда сброса). */
  delete(peerId: number): void;
  /** Удаляет разговоры без активности с указанного момента; возвращает их число. */
  pruneSessions(before: string): number;
  /** Бот молчит в диалоге до этого момента (ISO): отвечает администратор. */
  getPausedUntil(peerId: number): string | undefined;
  setPausedUntil(peerId: number, until: string | undefined): void;
}

/** Служебные отметки канала: обработанные события и разовые уведомления. */
export interface ChannelStore {
  /** true — событие новое и отмечено; false — уже обрабатывалось. */
  markEventProcessed(eventKey: string, at: string): boolean;
  /** Удаляет отметки старше указанного момента. */
  pruneProcessedEvents(before: string): void;
  /** Когда собеседнику последний раз отправлялось уведомление этого вида. */
  getNoticeAt(peerId: number, kind: string): string | undefined;
  setNoticeAt(peerId: number, kind: string, at: string): void;
}

/** Дневные счётчики бота: только ключ и количество, без текста и идентификаторов. */
export interface StatsStore {
  incrementStat(day: string, key: string, by?: number): void;
  /** Счётчики начиная с дня «ГГГГ-ММ-ДД». */
  readStats(fromDay: string): { day: string; key: string; count: number }[];
}
