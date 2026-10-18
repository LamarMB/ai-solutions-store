/** Запись на приём. Только вымышленные данные: врач, слот и id диалога ВКонтакте. */
export type Booking = {
  id: number;
  /** Идентификатор собеседника (peer_id ВКонтакте или id симулятора). */
  peerId: number;
  doctorId: string;
  /** Дата «ГГГГ-ММ-ДД» и время «ЧЧ:ММ» — локальные для клиники. */
  date: string;
  time: string;
  createdAt: string;
};

export type NewBooking = Omit<Booking, "id">;

/**
 * Хранилище записей. Защита от двойного бронирования — на уровне хранилища:
 * активная запись на один и тот же слот врача может быть только одна.
 */
export interface BookingRepository {
  /** `conflict` — слот уже занят другой активной записью. */
  insert(
    booking: NewBooking,
  ): { status: "ok"; booking: Booking } | { status: "conflict" };
  /** Активные записи собеседника, начиная с указанной даты, по возрастанию времени. */
  listActiveByPeer(peerId: number, fromDate: string): Booking[];
  /** Занятые слоты врача на дату (только время). */
  listBookedTimes(doctorId: string, date: string): string[];
  /** Отменяет активную запись собеседника; false — записи нет или она чужая. */
  cancel(peerId: number, bookingId: number, cancelledAt: string): boolean;
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
