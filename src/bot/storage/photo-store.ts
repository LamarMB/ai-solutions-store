import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  inspectImage,
  type ImageProblem,
  type PhotoType,
} from "@/bot/storage/image";

/** Откуда фото: демо-портрет, созданный ИИ, или загрузка сотрудником в панели. */
export type PhotoSource = "demo_ai" | "upload";

export type PhotoMeta = {
  doctorId: string;
  type: PhotoType;
  width: number;
  height: number;
  sha256: string;
  source: PhotoSource;
  updatedAt: string;
};

type Row = {
  doctor_id: string;
  mime: PhotoType;
  width: number;
  height: number;
  sha256: string;
  source: PhotoSource;
  updated_at: string;
};

/**
 * Фотографии врачей — в той же базе SQLite, что записи и справочники: попадают
 * в резервную копию (`npm run db:backup`), переживают перезапуск и деплой, не
 * зависят от каталога сборки. Перед сохранением содержимое проверяется
 * (`inspectImage`): только JPEG, PNG, WebP.
 */
export class PhotoStore {
  constructor(private readonly db: DatabaseSync) {}

  set(
    doctorId: string,
    bytes: Uint8Array,
    source: PhotoSource,
    at: string,
    userId: number | null,
  ): { ok: true; meta: PhotoMeta } | { ok: false; problem: ImageProblem } {
    const checked = inspectImage(bytes);
    if (!checked.ok) return checked;
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    this.db
      .prepare(
        `INSERT INTO doctor_photos (doctor_id, mime, data, sha256, width, height, source, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (doctor_id) DO UPDATE SET mime = excluded.mime, data = excluded.data,
           sha256 = excluded.sha256, width = excluded.width, height = excluded.height,
           source = excluded.source, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      )
      .run(
        doctorId,
        checked.info.type,
        bytes,
        sha256,
        checked.info.width,
        checked.info.height,
        source,
        at,
        userId,
      );
    return { ok: true, meta: this.meta(doctorId)! };
  }

  remove(doctorId: string): boolean {
    return (
      Number(
        this.db
          .prepare("DELETE FROM doctor_photos WHERE doctor_id = ?")
          .run(doctorId).changes,
      ) > 0
    );
  }

  meta(doctorId: string): PhotoMeta | undefined {
    const r = this.db
      .prepare(
        "SELECT doctor_id, mime, width, height, sha256, source, updated_at FROM doctor_photos WHERE doctor_id = ?",
      )
      .get(doctorId) as Row | undefined;
    return r ? toMeta(r) : undefined;
  }

  /** Все фото без содержимого — для списков (адрес строится по хэшу). */
  all(): Map<string, PhotoMeta> {
    const rows = this.db
      .prepare(
        "SELECT doctor_id, mime, width, height, sha256, source, updated_at FROM doctor_photos",
      )
      .all() as Row[];
    return new Map(rows.map((r) => [r.doctor_id, toMeta(r)]));
  }

  read(
    doctorId: string,
  ): { type: PhotoType; data: Uint8Array; sha256: string } | undefined {
    const r = this.db
      .prepare(
        "SELECT mime, data, sha256 FROM doctor_photos WHERE doctor_id = ?",
      )
      .get(doctorId) as
      { mime: PhotoType; data: Uint8Array; sha256: string } | undefined;
    return r ? { type: r.mime, data: r.data, sha256: r.sha256 } : undefined;
  }
}

const toMeta = (r: Row): PhotoMeta => ({
  doctorId: r.doctor_id,
  type: r.mime,
  width: r.width,
  height: r.height,
  sha256: r.sha256,
  source: r.source,
  updatedAt: r.updated_at,
});

/** Адрес фото для приложения и панели; версия в адресе — для долгого кэша. */
export const photoUrl = (meta: PhotoMeta | undefined) =>
  meta
    ? `/api/miniapp/photos/${encodeURIComponent(meta.doctorId)}?v=${meta.sha256.slice(0, 12)}`
    : null;
