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
}
