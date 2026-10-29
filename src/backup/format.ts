import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

/**
 * Зашифрованная резервная копия базы клиники (файл .dmbk):
 *
 *   «DMBK» · версия (1 байт) · длина заголовка (uint32 BE) · заголовок JSON ·
 *   IV (12 байт) · тег GCM (16 байт) · шифротекст (gzip базы)
 *
 * AES-256-GCM; заголовок — дополнительные данные (AAD), его подмена ломает
 * расшифровку. Ключ шифрования выводится из BACKUP_KEY клиники (HKDF) с её
 * идентификатором: копию одной клиники нельзя расшифровать ключом другой и
 * восстановить в другую. BACKUP_KEY — отдельный от MEDICAL_DATA_KEY.
 * В заголовке нет персональных данных: клиника, время, версия схемы, размер, хэш.
 */

const MAGIC = Buffer.from("DMBK");
const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PREFIX = MAGIC.length + 1 + 4;
const MAX_HEADER = 4096;

export type BackupHeader = {
  clinic: string;
  /** Время снимка, ISO. */
  createdAt: string;
  /** PRAGMA user_version базы. */
  schema: number;
  /** Размер и SHA-256 базы до сжатия и шифрования. */
  size: number;
  sha256: string;
};

/** Ошибка копии: причина без содержимого и без ключей. */
export class BackupFormatError extends Error {}

/** BACKUP_KEY: 32 случайных байта в base64. */
export function parseBackupKey(value: string | undefined): Buffer {
  const key = Buffer.from((value ?? "").trim(), "base64");
  if (key.length !== 32)
    throw new BackupFormatError(
      "BACKUP_KEY: нужен ключ 32 байта в base64 (npm run backup -- keygen)",
    );
  return key;
}

const deriveKey = (master: Buffer, clinic: string) =>
  Buffer.from(
    hkdfSync(
      "sha256",
      master,
      Buffer.from("demo-med-backup"),
      `v1:${clinic}`,
      32,
    ),
  );

export const sha256 = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

export function encryptBackup(
  database: Buffer,
  master: Buffer,
  meta: Omit<BackupHeader, "size" | "sha256">,
): Buffer {
  const header: BackupHeader = {
    ...meta,
    size: database.length,
    sha256: sha256(database),
  };
  const json = Buffer.from(JSON.stringify(header));
  const prefix = Buffer.alloc(PREFIX);
  MAGIC.copy(prefix);
  prefix.writeUInt8(VERSION, MAGIC.length);
  prefix.writeUInt32BE(json.length, MAGIC.length + 1);
  const aad = Buffer.concat([prefix, json]);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(
    "aes-256-gcm",
    deriveKey(master, meta.clinic),
    iv,
  );
  cipher.setAAD(aad);
  const body = Buffer.concat([
    cipher.update(gzipSync(database)),
    cipher.final(),
  ]);
  return Buffer.concat([aad, iv, cipher.getAuthTag(), body]);
}

/** Заголовок без расшифровки — для списка копий и проверки клиники. */
export function readHeader(file: Buffer): {
  header: BackupHeader;
  aad: Buffer;
} {
  if (file.length < PREFIX || !file.subarray(0, 4).equals(MAGIC))
    throw new BackupFormatError("это не резервная копия «Демо-Мед»");
  if (file.readUInt8(4) !== VERSION)
    throw new BackupFormatError("неизвестная версия формата копии");
  const length = file.readUInt32BE(5);
  if (
    length > MAX_HEADER ||
    file.length < PREFIX + length + IV_BYTES + TAG_BYTES
  )
    throw new BackupFormatError("копия повреждена или обрезана");
  let header: BackupHeader;
  try {
    header = JSON.parse(file.subarray(PREFIX, PREFIX + length).toString());
  } catch {
    throw new BackupFormatError("копия повреждена: заголовок не читается");
  }
  return { header, aad: file.subarray(0, PREFIX + length) };
}

/**
 * Расшифровка с проверкой: та же клиника, тег GCM (ключ и целостность),
 * размер и SHA-256 базы. Любое несовпадение — ошибка, частичных данных нет.
 */
export function decryptBackup(
  file: Buffer,
  master: Buffer,
  clinic: string,
): { header: BackupHeader; database: Buffer } {
  const { header, aad } = readHeader(file);
  if (header.clinic !== clinic)
    throw new BackupFormatError(
      `копия другой клиники («${header.clinic}») — восстановление запрещено`,
    );
  const iv = file.subarray(aad.length, aad.length + IV_BYTES);
  const tag = file.subarray(
    aad.length + IV_BYTES,
    aad.length + IV_BYTES + TAG_BYTES,
  );
  const body = file.subarray(aad.length + IV_BYTES + TAG_BYTES);
  let database: Buffer;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(master, clinic),
      iv,
    );
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    database = gunzipSync(
      Buffer.concat([decipher.update(body), decipher.final()]),
    );
  } catch {
    throw new BackupFormatError(
      "не удалось расшифровать: неверный BACKUP_KEY или копия повреждена",
    );
  }
  if (database.length !== header.size || sha256(database) !== header.sha256)
    throw new BackupFormatError(
      "копия повреждена: контрольная сумма не совпала",
    );
  return { header, database };
}
