/**
 * Консультант не собирает персональные данные. Если пользователь всё же
 * написал email или телефон, они заменяются до передачи провайдеру.
 */
const EMAIL_RE = /[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+/g;
// Последовательности из 10+ цифр с типичными разделителями.
const PHONE_RE = /\+?\d[\d\s()-]{8,}\d/g;

export function redactContacts(text: string): {
  text: string;
  redacted: boolean;
} {
  let redacted = false;
  const out = text
    .replace(EMAIL_RE, () => {
      redacted = true;
      return "[email скрыт]";
    })
    .replace(PHONE_RE, (match) => {
      if (match.replace(/\D/g, "").length < 10) return match;
      redacted = true;
      return "[телефон скрыт]";
    });
  return { text: out, redacted };
}
