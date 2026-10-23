/**
 * Недорогие модели OpenAI для русского диалога — в порядке предпочтения.
 * Выбирается первая, доступная ключу (список моделей аккаунта).
 * gpt-5-nano не используется: OpenAI объявил о его отключении.
 */
export const MODEL_PREFERENCE = [
  "gpt-5.6-luna",
  "gpt-5-mini",
  "gpt-4.1-mini",
  "gpt-4o-mini",
] as const;

export function pickModels(available: readonly string[]): string[] {
  const set = new Set(available);
  return MODEL_PREFERENCE.filter((model) => set.has(model));
}
