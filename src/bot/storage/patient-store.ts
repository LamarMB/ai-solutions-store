import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/**
 * Данные одного пациента (VK ID = peer_id) в базе клиники: выгрузка и
 * удаление по запросу пациента (P0-11, docs/patient-data.md). База — только
 * этой клиники; другие пациенты не затрагиваются.
 *
 * Содержимое разговора, сведений для врача (согласия) и текстов обращений —
 * медицинские сведения: владелец и администратор их не получают ни через один
 * API (docs/medical-privacy.md). В выгрузку попадают только их наличие и даты;
 * удаляются они полностью.
 */

export type PatientBooking = {
  id: number;
  doctorId: string;
  doctorName: string | null;
  date: string;
  time: string;
  status: string;
  source: string;
  createdAt: string;
  cancelledAt: string | null;
  note: string | null;
};

export type PatientCounts = {
  bookings: number;
  /** Из них предстоящих подтверждённых — после удаления слоты освободятся. */
  upcomingBookings: number;
  conversation: number;
  consents: number;
  requests: number;
  pause: number;
  notices: number;
  processedEvents: number;
};

/** Что остаётся после удаления и почему — показывается до подтверждения. */
export type Retained = { category: string; count?: number; reason: string };

export const RETAINED_ALWAYS: Retained[] = [
  {
    category: "Переписка в сообщениях сообщества ВКонтакте",
    reason:
      "хранится во ВКонтакте, а не в системе; удалить её может руководитель сообщества в интерфейсе ВКонтакте",
  },
  {
    category: "Зашифрованные резервные копии базы",
    reason:
      "удалённые данные остаются в копиях до окончания их срока хранения (BACKUP_KEEP); при восстановлении старой копии удаление нужно выполнить повторно — docs/patient-data.md",
  },
  {
    category:
      "Текст сообщений, отправленный во внешний ИИ-сервис (если подключён)",
    reason:
      "обрабатывается и хранится по условиям провайдера; из системы удалить его нельзя",
  },
  {
    category: "Служебные отметки обработанных нажатий кнопок",
    reason: "не связаны с VK ID в базе; удаляются автоматически через 3 суток",
  },
];

const mnPrefix = (peerId: number) => `mn:${peerId}:`;

export class PatientDataStore {
  constructor(private readonly db: DatabaseSync) {}

  private count(sql: string, ...args: (string | number)[]): number {
    return (this.db.prepare(sql).get(...args) as { n: number }).n;
  }

  counts(peerId: number, today: string): PatientCounts {
    return {
      bookings: this.count(
        "SELECT COUNT(*) AS n FROM bookings WHERE peer_id = ?",
        peerId,
      ),
      upcomingBookings: this.count(
        "SELECT COUNT(*) AS n FROM bookings WHERE peer_id = ? AND status = 'confirmed' AND date >= ?",
        peerId,
        today,
      ),
      conversation: this.count(
        "SELECT COUNT(*) AS n FROM sessions WHERE peer_id = ?",
        peerId,
      ),
      consents: this.count(
        "SELECT COUNT(*) AS n FROM disclosure_consents WHERE peer_id = ?",
        peerId,
      ),
      requests: this.count(
        "SELECT COUNT(*) AS n FROM patient_requests WHERE peer_id = ?",
        peerId,
      ),
      pause: this.count(
        "SELECT COUNT(*) AS n FROM pauses WHERE peer_id = ?",
        peerId,
      ),
      notices: this.count(
        "SELECT COUNT(*) AS n FROM notices WHERE peer_id = ?",
        peerId,
      ),
      processedEvents: this.count(
        "SELECT COUNT(*) AS n FROM processed_events WHERE substr(event_key, 1, ?) = ?",
        mnPrefix(peerId).length,
        mnPrefix(peerId),
      ),
    };
  }

  /**
   * Журналы, ссылающиеся на записи и обращения пациента только номером: они
   * сохраняются (подотчётность доступа к сведениям), персональных данных в них нет.
   */
  retainedLogs(peerId: number): Retained[] {
    const medical = this.count(
      "SELECT COUNT(*) AS n FROM medical_access_log WHERE booking_id IN (SELECT id FROM bookings WHERE peer_id = ?)",
      peerId,
    );
    const requests = this.count(
      "SELECT COUNT(*) AS n FROM request_access_log WHERE request_id IN (SELECT id FROM patient_requests WHERE peer_id = ?)",
      peerId,
    );
    const audit = this.count(
      "SELECT COUNT(*) AS n FROM admin_audit WHERE entity = 'booking' AND entity_id IN (SELECT CAST(id AS TEXT) FROM bookings WHERE peer_id = ?)",
      peerId,
    );
    const reason =
      "журнал действий сотрудников: только номер записи или обращения, дата и действие — без VK ID и содержания";
    return [
      {
        category: "Журнал доступа к сведениям для врача",
        count: medical,
        reason,
      },
      { category: "Журнал открытия обращений", count: requests, reason },
      { category: "Журнал действий в панели по записям", count: audit, reason },
    ].filter((r) => r.count > 0);
  }

  /** Отпечаток данных: удаление подтверждается для того, что видел владелец. */
  fingerprint(peerId: number): string {
    const ids = (table: string) =>
      (
        this.db
          .prepare(`SELECT id FROM ${table} WHERE peer_id = ? ORDER BY id`)
          .all(peerId) as { id: number }[]
      ).map((r) => r.id);
    const session = this.db
      .prepare("SELECT updated_at FROM sessions WHERE peer_id = ?")
      .get(peerId) as { updated_at: string } | undefined;
    return createHash("sha256")
      .update(
        JSON.stringify([
          peerId,
          ids("bookings"),
          ids("disclosure_consents"),
          ids("patient_requests"),
          session?.updated_at ?? null,
        ]),
      )
      .digest("hex")
      .slice(0, 32);
  }

  export(peerId: number) {
    const bookings = (
      this.db
        .prepare(
          `SELECT b.id, b.doctor_id, d.name AS doctor_name, b.date, b.time, b.status, b.source,
                  b.created_at, b.cancelled_at, b.note
             FROM bookings b LEFT JOIN doctors d ON d.id = b.doctor_id
            WHERE b.peer_id = ? ORDER BY b.date, b.time, b.id`,
        )
        .all(peerId) as Record<string, string | number | null>[]
    ).map((r): PatientBooking => ({
      id: r.id as number,
      doctorId: r.doctor_id as string,
      doctorName: (r.doctor_name as string | null) ?? null,
      date: r.date as string,
      time: r.time as string,
      status: r.status as string,
      source: r.source as string,
      createdAt: r.created_at as string,
      cancelledAt: (r.cancelled_at as string | null) ?? null,
      note: (r.note as string | null) ?? null,
    }));
    const session = this.db
      .prepare("SELECT updated_at FROM sessions WHERE peer_id = ?")
      .get(peerId) as { updated_at: string } | undefined;
    const consents = (
      this.db
        .prepare(
          `SELECT id, booking_id, recipient_role, recipient_doctor_id, scope, purpose, status,
                  granted_at, revoked_at, expires_at, payload IS NOT NULL AS stored
             FROM disclosure_consents WHERE peer_id = ? ORDER BY id`,
        )
        .all(peerId) as Record<string, string | number | null>[]
    ).map((r) => ({
      id: r.id,
      bookingId: r.booking_id,
      recipientRole: r.recipient_role,
      recipientDoctorId: r.recipient_doctor_id,
      scope: r.scope,
      purpose: r.purpose,
      status: r.status,
      grantedAt: r.granted_at,
      revokedAt: r.revoked_at,
      expiresAt: r.expires_at,
      contentStored: r.stored === 1,
    }));
    const requests = (
      this.db
        .prepare(
          `SELECT id, status, consent_status, consent_version, created_at, revoked_at, done_at,
                  expires_at, payload IS NOT NULL AS stored
             FROM patient_requests WHERE peer_id = ? ORDER BY id`,
        )
        .all(peerId) as Record<string, string | number | null>[]
    ).map((r) => ({
      id: r.id,
      status: r.status,
      consentStatus: r.consent_status,
      consentVersion: r.consent_version,
      createdAt: r.created_at,
      revokedAt: r.revoked_at,
      doneAt: r.done_at,
      expiresAt: r.expires_at,
      textStored: r.stored === 1,
    }));
    const pause = this.db
      .prepare("SELECT until FROM pauses WHERE peer_id = ?")
      .get(peerId) as { until: string } | undefined;
    const notices = this.db
      .prepare(
        "SELECT kind, sent_at FROM notices WHERE peer_id = ? ORDER BY kind",
      )
      .all(peerId) as { kind: string; sent_at: string }[];
    return {
      bookings,
      conversation: session
        ? { stored: true, updatedAt: session.updated_at }
        : null,
      consents,
      requests,
      technical: {
        botPausedUntil: pause?.until ?? null,
        notices: notices.map((n) => ({ kind: n.kind, sentAt: n.sent_at })),
      },
    };
  }

  /**
   * Удаление всех данных пациента одной транзакцией: либо всё, либо ничего.
   * Журналы с номерами записей сохраняются (retainedLogs).
   */
  erase(peerId: number, today: string): PatientCounts {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const before = this.counts(peerId, today);
      this.db
        .prepare("DELETE FROM disclosure_consents WHERE peer_id = ?")
        .run(peerId);
      this.db
        .prepare("DELETE FROM patient_requests WHERE peer_id = ?")
        .run(peerId);
      this.db.prepare("DELETE FROM bookings WHERE peer_id = ?").run(peerId);
      this.db.prepare("DELETE FROM sessions WHERE peer_id = ?").run(peerId);
      this.db.prepare("DELETE FROM pauses WHERE peer_id = ?").run(peerId);
      this.db.prepare("DELETE FROM notices WHERE peer_id = ?").run(peerId);
      this.db
        .prepare(
          "DELETE FROM processed_events WHERE substr(event_key, 1, ?) = ?",
        )
        .run(mnPrefix(peerId).length, mnPrefix(peerId));
      this.db.exec("COMMIT");
      return before;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
