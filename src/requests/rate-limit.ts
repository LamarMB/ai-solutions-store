/**
 * Ограничение частоты: не больше `limit` попыток за `windowMs` на ключ.
 * Хранится в памяти процесса — достаточно для одного инстанса; при
 * масштабировании нужен общий счётчик (см. docs/requests.md).
 */
export function createRateLimiter({
  limit,
  windowMs,
  now = Date.now,
}: {
  limit: number;
  windowMs: number;
  now?: () => number;
}) {
  const hits = new Map<string, number[]>();

  return {
    /** Регистрирует попытку; false — лимит исчерпан. */
    attempt(key: string): boolean {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((at) => t - at < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.set(key, recent);
      // Чистим устаревшие ключи, чтобы карта не росла бесконечно.
      if (hits.size > 10_000) {
        for (const [k, v] of hits) {
          if (v.every((at) => t - at >= windowMs)) hits.delete(k);
        }
      }
      return true;
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;

/** Кэш результатов по ключу отправки: повторная отправка не создаёт вторую заявку. */
export function createIdempotencyCache<T>({
  ttlMs,
  now = Date.now,
}: {
  ttlMs: number;
  now?: () => number;
}) {
  const entries = new Map<string, { at: number; value: T }>();
  return {
    get(key: string): T | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (now() - entry.at >= ttlMs) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key: string, value: T) {
      entries.set(key, { at: now(), value });
      if (entries.size > 10_000) {
        const t = now();
        for (const [k, v] of entries) if (t - v.at >= ttlMs) entries.delete(k);
      }
    },
  };
}
