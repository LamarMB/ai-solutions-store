import type { Intent, TextInterpreter } from "@/bot/dialog/types";

const normalize = (text: string) =>
  text.toLowerCase().replaceAll("ё", "е").replace(/\s+/g, " ").trim();

/** Совпадение по началу слова, чтобы основа не находилась внутри других слов. */
function has(text: string, stems: readonly string[]): boolean {
  const words = text.split(/[^a-zа-я0-9-]+/).filter(Boolean);
  return stems.some((stem) =>
    stem.includes(" ")
      ? text.includes(stem)
      : words.some((word) => word.startsWith(stem)),
  );
}

/** Вопросы о здоровье: бот не даёт медицинских советов и не собирает жалобы. */
const MEDICAL = [
  "диагноз",
  "болит",
  "боль",
  "симптом",
  "лечить",
  "лечени",
  "лекарств",
  "таблетк",
  "препарат",
  "температур",
  "анализ",
  "жалоб",
];

/** Правила на ключевых словах — не языковая модель. */
export class RuleInterpreter implements TextInterpreter {
  interpret(raw: string): Intent {
    const text = normalize(raw);
    if (!text) return "unknown";
    if (has(text, MEDICAL)) return "medical";
    if (["начать", "старт", "start", "/start"].includes(text)) return "start";
    if (has(text, ["привет", "здравств", "добрый"])) return "start";
    if (["да", "подтверждаю", "верно", "ок"].includes(text)) return "yes";
    if (["нет", "не надо"].includes(text)) return "no";
    if (has(text, ["мои записи", "отмен", "перенес"])) return "my_bookings";
    if (has(text, ["запис", "прием", "врач"])) return "book";
    if (has(text, ["администратор", "оператор", "человек", "сотрудник"]))
      return "admin";
    if (has(text, ["меню", "назад"])) return "menu";
    return "unknown";
  }
}

export { normalize as normalizeText };
