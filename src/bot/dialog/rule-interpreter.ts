import type { Clinic } from "@/bot/clinic/types";
import type {
  InfoTopic,
  InterpretContext,
  Interpretation,
  TextInterpreter,
} from "@/bot/dialog/types";
import { addDays } from "@/bot/schedule/time";

export const normalizeText = (text: string) =>
  text.toLowerCase().replaceAll("ё", "е").replace(/\s+/g, " ").trim();

/** Совпадение по началу слова, чтобы основа не находилась внутри других слов. */
export function hasStem(text: string, stems: readonly string[]): boolean {
  const words = text.split(/[^a-zа-я0-9-]+/).filter(Boolean);
  return stems.some((stem) =>
    stem.includes(" ")
      ? text.includes(stem)
      : words.some((word) => word.startsWith(stem)),
  );
}

/** Медицинские темы для правил: бот не даёт советов (жалобы разбирает conversation/triage). */
export const MEDICAL_STEMS = [
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
  "выписк",
  "рецепт",
];

const TOPICS: [InfoTopic, string[]][] = [
  ["prices", ["цен", "стоимост", "стоит", "сколько стоит", "прайс", "оплат"]],
  [
    "address",
    [
      "адрес",
      "находит",
      "где вы",
      "режим",
      "график работы",
      "часы работы",
      "работаете",
    ],
  ],
  ["route", ["добрать", "проезд", "парковк", "доехать"]],
  ["prep", ["подготов", "что взять", "документы взять", "паспорт"]],
  ["doctors", ["какие врачи", "кто принимает", "врачи", "специалист"]],
];

/** Ключевые слова направлений — дополняют названия из справочника. */
const SPECIALTY_STEMS: Record<string, string[]> = {
  therapist: ["терапевт"],
  dentist: ["стоматолог", "зуб", "дантист"],
  pediatrician: ["педиатр", "ребен", "детск", "дет"],
  ent: ["лор", "отоларинголог", "оториноларинголог", "ухо", "горл", "нос"],
  orthopedist: ["ортопед", "травматолог"],
};

/** Правила на ключевых словах — не языковая модель. Работают без сети. */
export class RuleInterpreter implements TextInterpreter {
  constructor(private readonly clinic?: Clinic) {}

  interpret(raw: string, context?: InterpretContext): Interpretation {
    const text = normalizeText(raw);
    if (!text) return { intent: "other" };
    if (hasStem(text, MEDICAL_STEMS)) return { intent: "medical" };
    if (["начать", "старт", "start", "/start"].includes(text))
      return { intent: "greeting" };
    if (["да", "подтверждаю", "верно", "ок", "давайте"].includes(text))
      return { intent: "yes" };
    if (["нет", "не надо", "не нужно"].includes(text)) return { intent: "no" };
    if (
      hasStem(text, [
        "администратор",
        "оператор",
        "человек",
        "сотрудник",
        "живой",
      ])
    )
      return { intent: "admin" };
    if (hasStem(text, ["мои записи", "отмен", "перенес", "мою запись"]))
      return { intent: "my_bookings" };

    const booking = this.bookingHints(text, context);
    // Явная просьба записаться важнее вопроса («запишите, сколько стоит?» — запись).
    if (hasStem(text, ["запис", "запиш", "попасть"]))
      return { intent: "book", ...booking };
    // «Сколько стоит приём терапевта?» — вопрос о цене, а не запись.
    for (const [topic, stems] of TOPICS) {
      if (hasStem(text, stems)) return { intent: "question", topic };
    }
    // «Давай на завтра», «в 10:30» — продолжение записи: бот дополнит выбранным врачом.
    if (
      hasStem(text, ["прием"]) ||
      booking.doctorId ||
      booking.specialtyId ||
      booking.date ||
      booking.time
    ) {
      return { intent: "book", ...booking };
    }
    if (hasStem(text, ["привет", "здравств", "добрый"]))
      return { intent: "greeting" };
    if (hasStem(text, ["меню", "назад"])) return { intent: "menu" };
    return { intent: "other" };
  }

  private bookingHints(text: string, context?: InterpretContext) {
    const hints: Pick<
      Interpretation,
      "specialtyId" | "doctorId" | "date" | "time"
    > = {};
    if (this.clinic) {
      const doctor = this.clinic.doctors.find((d) =>
        d.name
          .toLowerCase()
          .replaceAll("ё", "е")
          .split(" ")
          .some(
            (part) => part.length > 3 && hasStem(text, [part.slice(0, -1)]),
          ),
      );
      if (doctor) {
        hints.doctorId = doctor.id;
        hints.specialtyId = doctor.specialtyId;
      }
    }
    if (!hints.specialtyId) {
      const found = Object.entries(SPECIALTY_STEMS).find(([, stems]) =>
        hasStem(text, stems),
      );
      if (found) hints.specialtyId = found[0];
    }
    if (context) {
      if (hasStem(text, ["сегодня"])) hints.date = context.today;
      else if (hasStem(text, ["послезавтра"]))
        hints.date = addDays(context.today, 2);
      else if (hasStem(text, ["завтра"]))
        hints.date = addDays(context.today, 1);
    }
    const time = text.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
    if (time) hints.time = `${time[1].padStart(2, "0")}:${time[2]}`;
    return hints;
  }
}
