import { createHash, randomBytes } from "node:crypto";

type HeaderSource = { get(name: string): string | null };

/**
 * Адрес клиента для ограничения частоты.
 *
 * Берётся ПОСЛЕДНИЙ адрес из `X-Forwarded-For`: его добавляет ближайший доверенный
 * прокси (nginx с `$proxy_add_x_forwarded_for`) или сам Next.js, если заголовка не было.
 * Первые адреса присылает клиент, и подменой первого лимит обходился бы на каждой
 * попытке. В production прокси должен перезаписывать заголовок (docs/deployment-plan.md).
 */
export function clientAddress(headers: HeaderSource): string {
  const forwarded = headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return forwarded?.at(-1) || headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Ключ клиента: SHA-256 от адреса с солью, которая живёт только в памяти процесса.
 * Сам адрес нигде не хранится, а по хэшу его нельзя восстановить.
 */
export function createClientKeyHasher(salt: Buffer = randomBytes(16)) {
  return (headers: HeaderSource) =>
    createHash("sha256")
      .update(salt)
      .update(clientAddress(headers))
      .digest("hex");
}
