import type { DatabaseSync } from "node:sqlite";
import type { MedicalCipher } from "@/bot/storage/medical-crypto";

/**
 * Сведения, которые пациент сам разрешил передать врачу: краткое описание
 * жалобы из разговора с ботом — не переписка целиком.
 */
export type MedicalSummary = {
  /** Область жалобы для врача («суставы, спина, травмы»). */
  area: string;
  /** Как описал пациент (до 120 символов). */
  summary: string;
  trauma?: "yes" | "no";
  duration?: string;
  /** Тревожные признаки, о которых пациент написал. */
  redFlags: string[];
  /** Пациент ответил, что тревожных признаков нет. */
  redFlagsDenied: boolean;
};

export type ConsentScope = "complaint_summary";

export type AccessLogEntry = {
  at: string;
  login: string | null;
  bookingId: number;
  action: string;
  result: string;
};

type ConsentRow = {
  id: number;
  booking_id: number;
  recipient_doctor_id: string | null;
  payload: string | null;
};

/**
 * Согласия пациентов и журнал доступа. Правило по умолчанию — отказ:
 * без строки со статусом granted, неистёкшей, для этой записи и этого
 * получателя сведения не выдаются никому. Содержимое зашифровано
 * (MEDICAL_DATA_KEY); без ключа согласия не создаются.
 *
 * Получатель «admin» предусмотрен схемой для следующего этапа (явная передача
 * фрагмента переписки администратору), но код его пока не создаёт и не выдаёт.
 */
export class ConsentStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly cipher?: MedicalCipher,
  ) {}

  /** Передача сведений возможна только при настроенном шифровании. */
  get enabled(): boolean {
    return this.cipher !== undefined;
  }

  /**
   * Пациент разрешил передать описание жалобы врачу своей записи.
   * Прежнее согласие на эту запись отзывается: действует только последнее.
   */
  grantToDoctor(input: {
    bookingId: number;
    peerId: number;
    doctorId: string;
    summary: MedicalSummary;
    at: string;
    expiresAt: string;
  }): number {
    if (!this.cipher) throw new Error("medical cipher is not configured");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.revokeRows(input.bookingId, input.peerId, input.at);
      const id = Number(
        this.db
          .prepare(
            `INSERT INTO disclosure_consents
             (booking_id, peer_id, recipient_role, recipient_doctor_id, scope, purpose, payload, status, granted_at, expires_at)
             VALUES (?, ?, 'doctor', ?, 'complaint_summary', 'подготовка врача к приёму', NULL, 'granted', ?, ?)`,
          )
          .run(
            input.bookingId,
            input.peerId,
            input.doctorId,
            input.at,
            input.expiresAt,
          ).lastInsertRowid,
      );
      // Контекст шифрования привязан к номеру согласия: строку нельзя переставить.
      this.db
        .prepare("UPDATE disclosure_consents SET payload = ? WHERE id = ?")
        .run(
          this.cipher.encrypt(JSON.stringify(input.summary), `consent:${id}`),
          id,
        );
      this.db.exec("COMMIT");
      return id;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private revokeRows(bookingId: number, peerId: number, at: string): number {
    return Number(
      this.db
        .prepare(
          "UPDATE disclosure_consents SET status = 'revoked', revoked_at = ?, payload = NULL WHERE booking_id = ? AND peer_id = ? AND status = 'granted'",
        )
        .run(at, bookingId, peerId).changes,
    );
  }

  /** Отзыв пациентом: содержимое удаляется сразу. Только своё согласие. */
  revoke(peerId: number, bookingId: number, at: string): boolean {
    return this.revokeRows(bookingId, peerId, at) > 0;
  }

  /**
   * Запись отменена или передана другому врачу: согласие больше не действует,
   * содержимое удаляется. Новый врач сведений не получает без нового согласия.
   */
  revokeForBooking(bookingId: number, at: string): number {
    return Number(
      this.db
        .prepare(
          "UPDATE disclosure_consents SET status = 'revoked', revoked_at = ?, payload = NULL WHERE booking_id = ? AND status = 'granted'",
        )
        .run(at, bookingId).changes,
    );
  }

  /** Записи пациента, по которым сейчас действует согласие. */
  activeBookingIds(peerId: number, now: string): Set<number> {
    return new Set(
      (
        this.db
          .prepare(
            "SELECT booking_id FROM disclosure_consents WHERE peer_id = ? AND status = 'granted' AND expires_at > ?",
          )
          .all(peerId, now) as { booking_id: number }[]
      ).map((r) => r.booking_id),
    );
  }

  /** Есть ли действующее согласие для этой записи и этого врача (без раскрытия содержания). */
  hasActiveForDoctor(
    bookingId: number,
    doctorId: string,
    now: string,
  ): boolean {
    return this.find(bookingId, doctorId, now) !== undefined;
  }

  private find(bookingId: number, doctorId: string, now: string) {
    return this.db
      .prepare(
        `SELECT id, booking_id, recipient_doctor_id, payload FROM disclosure_consents
         WHERE booking_id = ? AND recipient_role = 'doctor' AND recipient_doctor_id = ?
           AND status = 'granted' AND expires_at > ? AND payload IS NOT NULL
         ORDER BY id DESC LIMIT 1`,
      )
      .get(bookingId, doctorId, now) as ConsentRow | undefined;
  }

  /** Сведения для врача записи — только по действующему согласию. */
  readForDoctor(
    bookingId: number,
    doctorId: string,
    now: string,
  ): { consentId: number; summary: MedicalSummary } | undefined {
    const row = this.find(bookingId, doctorId, now);
    if (!row || !this.cipher) return undefined;
    const text = this.cipher.decrypt(row.payload!, `consent:${row.id}`);
    if (text === undefined) return undefined;
    return { consentId: row.id, summary: JSON.parse(text) as MedicalSummary };
  }

  logAccess(entry: {
    userId: number;
    consentId: number | null;
    bookingId: number;
    action: string;
    result: string;
    at: string;
  }) {
    this.db
      .prepare(
        "INSERT INTO medical_access_log (at, user_id, consent_id, booking_id, action, result) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        entry.at,
        entry.userId,
        entry.consentId,
        entry.bookingId,
        entry.action,
        entry.result,
      );
  }

  listAccessLog(limit = 100): AccessLogEntry[] {
    return (
      this.db
        .prepare(
          `SELECT l.at, u.login, l.booking_id, l.action, l.result FROM medical_access_log l
           LEFT JOIN admin_users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT ?`,
        )
        .all(limit) as {
        at: string;
        login: string | null;
        booking_id: number;
        action: string;
        result: string;
      }[]
    ).map((r) => ({
      at: r.at,
      login: r.login,
      bookingId: r.booking_id,
      action: r.action,
      result: r.result,
    }));
  }

  /** Истёкшие согласия: статус expired, содержимое удаляется. */
  purgeExpired(now: string): number {
    return Number(
      this.db
        .prepare(
          "UPDATE disclosure_consents SET status = 'expired', payload = NULL WHERE status = 'granted' AND expires_at <= ?",
        )
        .run(now).changes,
    );
  }

  /** Количество действующих согласий по получателю — для проверок и отчёта. */
  countActive(recipientRole: "doctor" | "admin", now: string): number {
    return (
      this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM disclosure_consents WHERE recipient_role = ? AND status = 'granted' AND expires_at > ?",
        )
        .get(recipientRole, now) as { n: number }
    ).n;
  }
}
