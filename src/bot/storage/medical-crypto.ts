import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Шифрование медицинских сведений в базе (AES-256-GCM, node:crypto).
 *
 * Ключ — переменная MEDICAL_DATA_KEY (32 байта в base64), хранится вне базы.
 * Защищает копии и выгрузки базы (резервные копии, перенос файла, случайный
 * доступ к файлу без ключа). НЕ защищает от того, у кого есть и база, и ключ —
 * то есть от администратора сервера: это ограничение описано в
 * docs/medical-privacy.md.
 */
const PREFIX = "enc:v1:";

export class MedicalCipher {
  private constructor(private readonly key: Buffer) {}

  /** Ключ из base64; неверный ключ — ошибка при запуске, а не тихая работа без шифрования. */
  static fromBase64(value: string): MedicalCipher {
    const key = Buffer.from(value.trim(), "base64");
    if (key.length !== 32)
      throw new Error("MEDICAL_DATA_KEY: нужен ключ 32 байта в base64");
    return new MedicalCipher(key);
  }

  static generateKey(): string {
    return randomBytes(32).toString("base64");
  }

  /**
   * `context` (например, «session:123» или «consent:5») связывает шифротекст с
   * его местом: строку нельзя незаметно переставить в чужую запись.
   */
  encrypt(plaintext: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const data = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return (
      PREFIX +
      [iv, cipher.getAuthTag(), data]
        .map((b) => b.toString("base64url"))
        .join(".")
    );
  }

  /** undefined — не расшифровывается (другой ключ, повреждение, чужой контекст). */
  decrypt(value: string, context: string): string | undefined {
    if (!isEncrypted(value)) return undefined;
    const [iv, tag, data] = value
      .slice(PREFIX.length)
      .split(".")
      .map((part) => Buffer.from(part, "base64url"));
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString(
        "utf8",
      );
    } catch {
      return undefined;
    }
  }
}

export const isEncrypted = (value: string) => value.startsWith(PREFIX);
