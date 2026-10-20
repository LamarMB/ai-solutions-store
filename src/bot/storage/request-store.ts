import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { MedicalCipher } from "@/bot/storage/medical-crypto";

/**
 * Версия текста согласия на передачу обращения администратору. Меняется, если
 * меняется формулировка, которую видит пациент (dialog.ts, requestPreview).
 */
export const REQUEST_CONSENT_VERSION = 1;
/** Сколько хранится обращение; после отметки «обработано» — не дольше 7 дней. */
export const REQUEST_TTL_DAYS = 30;
export const REQUEST_DONE_TTL_DAYS = 7;
/** Повтор того же текста в течение этого времени — то же обращение, не новое. */
const REPEAT_WINDOW_MS = 10 * 60 * 1000;

export type RequestStatus = "new" | "done";
export type RequestConsent = "granted" | "revoked" | "expired";

/** Обращение для списка в панели: без содержания и без VK ID. */
export type RequestMeta = {
  id: number;
  createdAt: string;
  status: RequestStatus;
  consent: RequestConsent;
  /** Содержание доступно (согласие действует и текст не удалён). */
  available: boolean;
  patient: string;
  doneAt: string | null;
  doneBy: string | null;
  revokedAt: string | null;
};

export type RequestAccessEntry = {
  at: string;
  login: string | null;
  requestId: number;
  action: string;
  result: string;
};

type Row = {
  id: number;
  peer_id: number;
  status: RequestStatus;
  consent_status: RequestConsent;
  text_sha256: string;
  payload: string | null;
  created_at: string;
  revoked_at: string | null;
  done_at: string | null;
  done_login: string | null;
  expires_at: string;
};

export const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

const plusDays = (iso: string, days: number) =>
  new Date(Date.parse(iso) + days * 86_400_000).toISOString();

/**
 * Обращения пациентов к администратору с явным согласием на передачу текста.
 *
 * Сохраняется только текст, который пациент видел в предпросмотре и разрешил
 * передать (дословно), — зашифрованный ключом MEDICAL_DATA_KEY, с SHA-256 для
 * проверки неизменности. Изменить текст после согласия нельзя: в коде нет такой
 * операции, а триггеры базы запрещают переписать содержимое и хэш. Отзыв и
 * истечение срока удаляют содержимое. Без ключа обращения не создаются.
 *
 * Это регулирует только нашу систему: исходную переписку в сообщениях
 * сообщества ВКонтакте руководители сообщества видят независимо от этого.
 */
export class RequestStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly cipher?: MedicalCipher,
  ) {}

  get enabled(): boolean {
    return this.cipher !== undefined;
  }

  /** Создаёт обращение; повтор того же текста (повторное нажатие) — то же обращение. */
  create(
    peerId: number,
    text: string,
    at: string,
  ): { id: number; repeated: boolean } {
    if (!this.cipher) throw new Error("medical cipher is not configured");
    const hash = sha256(text);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const same = this.db
        .prepare(
          `SELECT id FROM patient_requests
           WHERE peer_id = ? AND text_sha256 = ? AND consent_status = 'granted' AND created_at > ?
           ORDER BY id DESC LIMIT 1`,
        )
        .get(
          peerId,
          hash,
          new Date(Date.parse(at) - REPEAT_WINDOW_MS).toISOString(),
        ) as { id: number } | undefined;
      if (same) {
        this.db.exec("COMMIT");
        return { id: same.id, repeated: true };
      }
      const id = Number(
        this.db
          .prepare(
            `INSERT INTO patient_requests
             (peer_id, status, consent_status, consent_version, text_kind, text_sha256, payload, created_at, expires_at)
             VALUES (?, 'new', 'granted', ?, 'verbatim', ?, NULL, ?, ?)`,
          )
          .run(
            peerId,
            REQUEST_CONSENT_VERSION,
            hash,
            at,
            plusDays(at, REQUEST_TTL_DAYS),
          ).lastInsertRowid,
      );
      // Контекст шифрования — номер обращения: строку нельзя переставить.
      this.db
        .prepare("UPDATE patient_requests SET payload = ? WHERE id = ?")
        .run(this.cipher.encrypt(text, `request:${id}`), id);
      this.db.exec("COMMIT");
      return { id, repeated: false };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Отзыв пациентом: только свои обращения; содержимое удаляется сразу. */
  revoke(peerId: number, at: string, requestId?: number): number[] {
    const ids = (
      this.db
        .prepare(
          `SELECT id FROM patient_requests WHERE peer_id = ? AND consent_status = 'granted'${requestId !== undefined ? " AND id = ?" : ""}`,
        )
        .all(...(requestId !== undefined ? [peerId, requestId] : [peerId])) as {
        id: number;
      }[]
    ).map((r) => r.id);
    for (const id of ids)
      this.db
        .prepare(
          "UPDATE patient_requests SET consent_status = 'revoked', revoked_at = ?, payload = NULL WHERE id = ?",
        )
        .run(at, id);
    return ids;
  }

  /** Обращения собеседника с действующим согласием. */
  activeIds(peerId: number, now: string): number[] {
    return (
      this.db
        .prepare(
          "SELECT id FROM patient_requests WHERE peer_id = ? AND consent_status = 'granted' AND expires_at > ? ORDER BY id",
        )
        .all(peerId, now) as { id: number }[]
    ).map((r) => r.id);
  }

  private row(id: number): Row | undefined {
    return this.db
      .prepare(
        `SELECT r.id, r.peer_id, r.status, r.consent_status, r.text_sha256, r.payload, r.created_at,
                r.revoked_at, r.done_at, u.login AS done_login, r.expires_at
         FROM patient_requests r LEFT JOIN admin_users u ON u.id = r.done_by WHERE r.id = ?`,
      )
      .get(id) as Row | undefined;
  }

  private meta(r: Row, now: string): RequestMeta {
    const expired = r.consent_status === "granted" && r.expires_at <= now;
    return {
      id: r.id,
      createdAt: r.created_at,
      status: r.status,
      consent: expired ? "expired" : r.consent_status,
      available:
        r.consent_status === "granted" && !expired && r.payload !== null,
      patient: `ВКонтакте, id…${String(r.peer_id).slice(-3)}`,
      doneAt: r.done_at,
      doneBy: r.done_login,
      revokedAt: r.revoked_at,
    };
  }

  /** Список для панели: новые сначала; без содержания. */
  list(now: string, limit = 200): RequestMeta[] {
    return (
      this.db
        .prepare(
          `SELECT r.id, r.peer_id, r.status, r.consent_status, r.text_sha256, r.payload, r.created_at,
                  r.revoked_at, r.done_at, u.login AS done_login, r.expires_at
           FROM patient_requests r LEFT JOIN admin_users u ON u.id = r.done_by
           ORDER BY r.status = 'done', r.id DESC LIMIT ?`,
        )
        .all(limit) as Row[]
    ).map((r) => this.meta(r, now));
  }

  get(id: number, now: string): RequestMeta | undefined {
    const r = this.row(id);
    return r ? this.meta(r, now) : undefined;
  }

  /**
   * Текст обращения — только при действующем согласии, неистёкшем сроке и
   * совпадении SHA-256 с утверждённым пациентом текстом.
   */
  read(
    id: number,
    now: string,
  ):
    | { ok: true; text: string; meta: RequestMeta }
    | { ok: false; reason: "missing" | "revoked" | "expired" | "integrity" } {
    const r = this.row(id);
    if (!r) return { ok: false, reason: "missing" };
    const meta = this.meta(r, now);
    if (meta.consent === "revoked") return { ok: false, reason: "revoked" };
    if (!meta.available || !this.cipher)
      return { ok: false, reason: "expired" };
    const text = this.cipher.decrypt(r.payload!, `request:${r.id}`);
    if (text === undefined || sha256(text) !== r.text_sha256)
      return { ok: false, reason: "integrity" };
    return { ok: true, text, meta };
  }

  /** «Обработано»: содержимое хранится не дольше 7 дней после этого. */
  markDone(id: number, userId: number, at: string): boolean {
    const r = this.row(id);
    if (!r) return false;
    const until = plusDays(at, REQUEST_DONE_TTL_DAYS);
    this.db
      .prepare(
        "UPDATE patient_requests SET status = 'done', done_at = COALESCE(done_at, ?), done_by = COALESCE(done_by, ?), expires_at = MIN(expires_at, ?) WHERE id = ?",
      )
      .run(at, userId, until, id);
    return true;
  }

  /** Истёкшие обращения: статус expired, содержимое удаляется. */
  purgeExpired(now: string): number {
    return Number(
      this.db
        .prepare(
          "UPDATE patient_requests SET consent_status = 'expired', payload = NULL WHERE consent_status = 'granted' AND expires_at <= ?",
        )
        .run(now).changes,
    );
  }

  countActive(now: string): number {
    return (
      this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM patient_requests WHERE consent_status = 'granted' AND expires_at > ?",
        )
        .get(now) as { n: number }
    ).n;
  }

  logAccess(entry: {
    userId: number;
    requestId: number;
    action: string;
    result: string;
    at: string;
  }) {
    this.db
      .prepare(
        "INSERT INTO request_access_log (at, user_id, request_id, action, result) VALUES (?, ?, ?, ?, ?)",
      )
      .run(entry.at, entry.userId, entry.requestId, entry.action, entry.result);
  }

  listAccessLog(limit = 100): RequestAccessEntry[] {
    return (
      this.db
        .prepare(
          `SELECT l.at, u.login, l.request_id, l.action, l.result FROM request_access_log l
           LEFT JOIN admin_users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT ?`,
        )
        .all(limit) as {
        at: string;
        login: string | null;
        request_id: number;
        action: string;
        result: string;
      }[]
    ).map((r) => ({
      at: r.at,
      login: r.login,
      requestId: r.request_id,
      action: r.action,
      result: r.result,
    }));
  }
}
