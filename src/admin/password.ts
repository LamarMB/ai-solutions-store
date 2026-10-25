import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Пароли администраторов — только хэш scrypt со случайной солью (встроенный
 * node:crypto, без зависимостей). Формат: scrypt$N$r$p$соль$хэш (base64url).
 */
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
/** scrypt с N=2^15, r=8 использует ~32 МБ — с запасом. */
const MAX_MEMORY = 64 * 1024 * 1024;

export const PASSWORD_MIN_LENGTH = 10;

function derive(
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEY_LENGTH,
      { N: n, r, p, maxmem: MAX_MEMORY },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return [
    "scrypt",
    N,
    R,
    P,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

/** Сравнение за постоянное время; неверный формат хэша — просто «не совпало». */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const key = await derive(
    password,
    Buffer.from(salt, "base64url"),
    Number(n),
    Number(r),
    Number(p),
  ).catch(() => undefined);
  return (
    key !== undefined &&
    key.length === expected.length &&
    timingSafeEqual(key, expected)
  );
}

/** Требования к паролю — простые и понятные администратору. */
export function passwordProblem(password: string): string | undefined {
  if (password.length < PASSWORD_MIN_LENGTH)
    return `Пароль должен быть не короче ${PASSWORD_MIN_LENGTH} символов.`;
  if (password.length > 200) return "Пароль слишком длинный.";
  if (!/[a-zа-яё]/i.test(password) || !/\d/.test(password))
    return "Пароль должен содержать буквы и цифры.";
  return undefined;
}
