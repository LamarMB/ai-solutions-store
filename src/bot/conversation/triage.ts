import { clauses, normalizeForRules } from "@/bot/conversation/safety";

/**
 * Административная маршрутизация жалобы: область жалобы и какие общие вопросы
 * задать перед записью. Это не диагностика: вопросы нужны только чтобы не
 * пропустить признаки срочности. Направление клиники для области — по
 * справочнику (conversation/specialties.ts).
 */
export const COMPLAINT_AREAS = [
  "joint",
  "dental",
  "ent",
  "child",
  "general",
] as const;
export type ComplaintArea = (typeof COMPLAINT_AREAS)[number];

export const QUESTION_KEYS = ["trauma", "duration", "red_flags"] as const;
export type QuestionKey = (typeof QUESTION_KEYS)[number];

/**
 * Что нужно уточнить перед записью. Зубы и ЛОР — без вопросов: пациент сам
 * понимает, к кому идёт, а тревожные признаки правила ловят в любом сообщении.
 */
export const QUESTION_PLAN: Record<ComplaintArea, readonly QuestionKey[]> = {
  joint: ["trauma", "duration", "red_flags"],
  general: ["duration", "red_flags"],
  child: ["duration", "red_flags"],
  dental: [],
  ent: [],
};

const RED_FLAGS_QUESTION: Record<ComplaintArea, string> = {
  joint:
    "Есть ли сильный отёк, заметная деформация или настолько сильная боль, что трудно наступать или двигать суставом?",
  general:
    "Есть ли что-то из этого: затруднённое дыхание, боль или давление в груди, внезапная слабость или онемение, высокая температура, которая не снижается?",
  child:
    "Есть ли у ребёнка что-то из этого: затруднённое дыхание, высокая температура, которая не снижается, сильная вялость или сонливость?",
  dental:
    "Есть ли сильный отёк лица, высокая температура или кровотечение, которое не останавливается?",
  ent: "Есть ли затруднённое дыхание, сильный отёк или высокая температура, которая не снижается?",
};

export function questionText(key: QuestionKey, area: ComplaintArea): string {
  switch (key) {
    case "trauma":
      return "Подскажите, это началось после травмы — падения, удара — или без видимой причины?";
    case "duration":
      return "Как давно это беспокоит?";
    case "red_flags":
      return RED_FLAGS_QUESTION[area];
  }
}

const has = (text: string, stems: readonly string[]) => {
  const words = text.split(/[^a-zа-я0-9-]+/).filter(Boolean);
  return stems.some((stem) => words.some((w) => w.startsWith(stem)));
};
const hasWord = (text: string, list: readonly string[]) => {
  const words = text.split(/[^a-zа-я0-9-]+/).filter(Boolean);
  return list.some((w) => words.includes(w));
};

const AREA_STEMS: [ComplaintArea, string[], string[]][] = [
  // [область, основы слов, целые слова]
  [
    "child",
    [
      "ребен",
      "ребенк",
      "детск",
      "малыш",
      "сыну",
      "сына",
      "дочк",
      "дочер",
      "дочь",
    ],
    ["сын", "дети", "детей"],
  ],
  ["dental", ["зуб", "десн", "пломб", "коронк", "челюст"], []],
  [
    "ent",
    ["горл", "насморк", "заложен", "пазух", "миндалин", "гайморит"],
    ["ухо", "уши", "ушах", "уха", "ушко", "нос", "носом", "носа"],
  ],
  [
    "joint",
    [
      "колен",
      "сустав",
      "спин",
      "поясниц",
      "плеч",
      "локот",
      "локт",
      "лодыжк",
      "голеностоп",
      "щиколот",
      "бедр",
      "запяст",
      "позвоноч",
      "шейн",
      "стоп",
      "пятк",
      "ахилл",
      "мениск",
      "связк",
      "растяж",
      "вывих",
      "ушиб",
      "подвернул",
    ],
    [
      "нога",
      "ногу",
      "ноги",
      "ногой",
      "рука",
      "руку",
      "руки",
      "кисть",
      "шея",
      "шею",
      "палец",
      "пальцы",
    ],
  ],
  [
    "general",
    [
      "температур",
      "кашл",
      "кашел",
      "слабост",
      "простуд",
      "голов",
      "давлени",
      "тошн",
      "живот",
      "желуд",
      "озноб",
      "недомога",
      "плохо",
    ],
    ["орви", "грипп"],
  ],
];

const SYMPTOM_STEMS = [
  "бол",
  "ноет",
  "ноющ",
  "ныть",
  "беспоко",
  "опух",
  "отек",
  "температур",
  "кашл",
  "кашел",
  "тошн",
  "слабост",
  "кровотеч",
  "онемел",
  "травм",
  "упал",
  "ушиб",
  "подвернул",
  "вывих",
  "растяж",
  "заложен",
  "насморк",
  "зуд",
  "кружит",
  "давит",
  "жжет",
  "тянет",
  "хруст",
  "щелка",
  "плохо",
  "недомога",
  "простуд",
  "озноб",
  "сыпь",
  "задыха",
  "перелом",
];

/**
 * Жалоба в тексте и её область. undefined — жалобы нет. `explicit` — область
 * названа прямо («колено», «зуб»); иначе это общее недомогание или ответ на
 * вопрос («без травмы», «отёка нет»), который не меняет тему разговора.
 */
export function detectComplaint(text: string):
  | {
      area: ComplaintArea;
      explicit: boolean;
      /**
       * Другие области в том же сообщении («болит зуб и колено»): жалоба
       * неоднозначна, бот не выбирает специалиста сам. У ребёнка — педиатр.
       */
      others?: ComplaintArea[];
    }
  | undefined {
  const norm = normalizeForRules(text);
  if (!has(norm, SYMPTOM_STEMS)) return undefined;
  const found = AREA_STEMS.filter(
    ([, stems, words]) => has(norm, stems) || hasWord(norm, words),
  ).map(([area]) => area);
  if (found.length === 0) return { area: "general", explicit: false };
  const [area, ...others] = found;
  return area === "child" || others.length === 0
    ? { area, explicit: true }
    : { area, explicit: true, others };
}

/** Короткое описание жалобы для памяти диалога (первая фраза, без лишнего). */
export function complaintSummary(text: string): string {
  return (clauses(text)[0] ?? "").slice(0, 120);
}
