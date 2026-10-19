import type { ScheduleProvider } from "@/bot/schedule/schedule";
import { addDays } from "@/bot/schedule/time";
import type { ConsentStore } from "@/bot/storage/consent-store";
import type { ConsentPort } from "@/bot/dialog/types";

/** Согласие действует до приёма и ещё 7 дней после него, затем сведения удаляются. */
export const CONSENT_DAYS_AFTER_VISIT = 7;

/**
 * Согласия пациента для диалога. Получатель — только врач записи (id врача
 * берётся из сохранённой записи, не из кнопки и не из текста). Запись должна
 * быть активной записью этого собеседника.
 */
export function createConsentPort(
  store: ConsentStore,
  schedule: Pick<ScheduleProvider, "listBookings">,
  now: () => Date,
): ConsentPort | undefined {
  if (!store.enabled) return undefined;
  return {
    share(peerId, bookingId, summary) {
      const booking = schedule
        .listBookings(peerId)
        .find((b) => b.id === bookingId);
      if (!booking) return false;
      store.grantToDoctor({
        bookingId,
        peerId,
        doctorId: booking.doctorId,
        summary,
        at: now().toISOString(),
        expiresAt: `${addDays(booking.date, CONSENT_DAYS_AFTER_VISIT + 1)}T00:00:00.000Z`,
      });
      return true;
    },
    revoke(peerId, bookingId) {
      return store.revoke(peerId, bookingId, now().toISOString());
    },
    sharedBookingIds(peerId) {
      return store.activeBookingIds(peerId, now().toISOString());
    },
  };
}
