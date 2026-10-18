/**
 * Консервативная проверка тревожных признаков — правила, а не модель.
 *
 * Бот не ставит диагнозы и не оценивает безопасность состояния: он только
 * замечает явно описанные опасные признаки и в этом случае сразу советует
 * экстренную помощь. Модель может добавить признак (повысить срочность), но
 * не может отменить сработавшее правило.
 */

/** Тревожные признаки, которые бот умеет распознать в тексте. */
export const RED_FLAGS = [
  "deformity",
  "cannot_bear_weight",
  "severe_swelling",
  "heavy_bleeding",
  "sudden_numbness",
  "severe_trauma",
  "chest_pain",
  "breathing_difficulty",
  "fainting",
  "stroke_signs",
] as const;
export type RedFlag = (typeof RED_FLAGS)[number];

export const URGENCY = ["none", "soon", "emergency"] as const;
export type Urgency = (typeof URGENCY)[number];

/**
 * Шаблон признака. `lead` — шаблон сам начинается с отрицания («не могу
 * наступить»): отрицание перед ним не проверяется. `inner` — отрицание внутри
 * шаблона («кровь не останавливается»).
 */
type Pattern = { re: RegExp; not?: "lead" | "inner" };

const W = String.raw`(?:\S+\s+)`; // одно промежуточное слово

const FLAG_PATTERNS: Record<RedFlag, Pattern[]> = {
  deformity: [
    { re: /деформ\S*/ },
    {
      re: new RegExp(
        String.raw`неестественн\S*\s+${W}?(?:изогн|согн|вывер|положени|угл)\S*`,
      ),
    },
    { re: /кость\s+(?:торчит|видн\S*|выпира\S*)/ },
    { re: /торчит\s+кость/ },
    {
      re: new RegExp(
        String.raw`(?:вывернут\S*|искривил\S*|искривлен\S*)\s+${W}?(?:нога|ногу|рука|руку|палец|колено|сустав|стопа)`,
      ),
    },
  ],
  cannot_bear_weight: [
    {
      re: new RegExp(
        String.raw`не\s+(?:могу|может|можем|получается|выходит|в\s+состоянии)\s+${W}{0,2}(?:наступ|опер|опир|встать|стоять|ходить|идти|пошевел|шевел|двига|согнуть|разогнуть)\S*`,
      ),
      not: "lead",
    },
    { re: /не\s+наступ\S*/, not: "lead" },
    {
      re: new RegExp(
        String.raw`невозможно\s+${W}?(?:наступ|опер|опир|встать|ходить|пошевел|двига)\S*`,
      ),
      not: "lead",
    },
    {
      re: new RegExp(
        String.raw`(?:трудно|тяжело)\s+${W}?(?:наступ|опер|опир|ходить|встать)\S*`,
      ),
    },
  ],
  severe_swelling: [
    {
      re: new RegExp(
        String.raw`(?:сильн\S*|очень|выраженн\S*|огромн\S*|резко)\s+${W}?(?:отек\S*|отекл\S*|опух\S*|распух\S*)`,
      ),
    },
    {
      re: new RegExp(
        String.raw`(?:отек\S*|отекл\S*|опух\S*|распух\S*)\s+${W}?(?:сильн\S*|огромн\S*|выраженн\S*)`,
      ),
    },
    { re: /раздуло/ },
  ],
  heavy_bleeding: [
    { re: /кровотечени\S*/ },
    { re: new RegExp(String.raw`(?:сильн\S*|обильн\S*|много)\s+${W}?кров\S*`) },
    {
      re: new RegExp(
        String.raw`кров\S*\s+${W}?(?:не\s+останавлива\S*|не\s+прекраща\S*|не\s+останавл\S*|хлещет|льется|течет\s+сильно)`,
      ),
      not: "inner",
    },
    { re: /хлещет\s+кров\S*/ },
  ],
  sudden_numbness: [
    {
      re: new RegExp(
        String.raw`(?:внезапн\S*|резко|вдруг|неожиданно)\s+${W}{0,2}(?:онемел\S*|онемени\S*|отнял\S*|ослабел\S*|перестал\S*\s+чувств\S*|не\s+чувству\S*)`,
      ),
      not: "inner",
    },
    {
      re: new RegExp(
        String.raw`(?:онемел\S*|онемени\S*|отнял\S*)\s+${W}{0,2}(?:внезапн\S*|резко|вдруг)`,
      ),
    },
    {
      re: new RegExp(
        String.raw`(?:потерял\S*|пропал\S*|исчезл\S*)\s+${W}?чувствительн\S*`,
      ),
    },
    {
      re: /не\s+чувству\S*\s+(?:ногу|ноги|руку|руки|пальц\S*|стоп\S*|лицо|половин\S*)/,
      not: "lead",
    },
    { re: /(?:нога|рука|ноги|руки)\s+отнял\S*/ },
  ],
  severe_trauma: [
    { re: /(?<![а-я])дтп(?![а-я])|авари\S*/ },
    { re: /сбил\S*\s+машин\S*|машин\S*\s+сбил\S*/ },
    {
      re: new RegExp(
        String.raw`(?:упал\S*|сорвал\S*|прыгнул\S*|свалил\S*)\s+${W}{0,2}(?:с\s+высот\S*|с\s+крыш\S*|с\s+балкон\S*|с\s+\S+\s+этаж\S*|с\s+лестниц\S*)`,
      ),
    },
    { re: new RegExp(String.raw`сильн\S*\s+удар\S*\s+${W}?голов\S*`) },
    { re: /перелом\S*/ },
    {
      re: /слома\S*\s+(?:\S+\s+)?(?:ногу|руку|палец|кость|ключиц\S*|ребр\S*|нос|лодыжк\S*|кисть|запясть\S*)/,
    },
  ],
  chest_pain: [
    {
      re: new RegExp(
        String.raw`(?:бол\S*|давит|давящ\S*|жжет|жжение|сжима\S*|колет)\s+${W}{0,2}(?:в\s+груди|за\s+грудин\S*|в\s+сердц\S*|сердц\S*)`,
      ),
    },
    {
      re: new RegExp(
        String.raw`(?:в\s+груди|грудь|сердце)\s+${W}?(?:бол\S*|давит|жжет|сжима\S*|колет)`,
      ),
    },
  ],
  breathing_difficulty: [
    {
      re: new RegExp(String.raw`(?:трудно|тяжело|сложно|больно)\s+${W}?дыш\S*`),
    },
    {
      re: /не\s+могу\s+(?:\S+\s+)?(?:дышать|вдохнуть|продышаться)/,
      not: "lead",
    },
    { re: /задыха\S*|не\s+хватает\s+воздуха|нечем\s+дышать/, not: "lead" },
  ],
  fainting: [
    {
      re: new RegExp(
        String.raw`(?:потерял\S*|теря\S*|терял\S*)\s+${W}?сознани\S*`,
      ),
    },
    { re: /обморок\S*|отключил(?:ся|ась)/ },
  ],
  stroke_signs: [
    {
      re: new RegExp(
        String.raw`перекос\S*\s+${W}?лиц\S*|лиц\S*\s+${W}?перекос\S*`,
      ),
    },
    {
      re: new RegExp(
        String.raw`(?:невнятн\S*|заплета\S*|нарушил\S*)\s+${W}?(?:речь|язык)`,
      ),
    },
    {
      re: /(?:речь|говорить)\s+(?:\S+\s+)?(?:нарушил\S*|невнятн\S*|спутан\S*)/,
    },
  ],
};

/** Признаки, при которых бот сразу советует экстренную помощь. */
const ALWAYS_EMERGENCY: readonly RedFlag[] = RED_FLAGS.filter(
  (f) => f !== "severe_swelling",
);

const NEGATORS = new Set([
  "нет",
  "без",
  "ни",
  "не",
  "нету",
  "никакого",
  "никакой",
  "никаких",
  "отсутствует",
]);

/** Нормализация для правил: регистр, «ё», пунктуация как граница фраз. */
export function normalizeForRules(text: string): string {
  return text
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[«»"“”()]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Фразы: отрицание действует только внутри своей фразы. */
export function clauses(text: string): string[] {
  return normalizeForRules(text)
    .split(/[.!?;:\n]+|,|\s(?:но|а|однако|зато|хотя)\s/)
    .map((c) => c.trim())
    .filter(Boolean);
}

function isNegated(
  clause: string,
  start: number,
  end: number,
  pattern: Pattern,
) {
  const match = clause.slice(start, end);
  const words = clause.slice(0, start).split(/\s+/).filter(Boolean);
  let before = words.slice(-3);
  // «без отёка и деформации»: отрицание распространяется на однородные слова.
  if (before.some((w) => w === "и" || w === "или" || w === "ни"))
    before = words.slice(-6);
  if (pattern.not !== "lead" && before.some((w) => NEGATORS.has(w)))
    return true;
  if (!pattern.not) {
    const inner = match.split(/\s+/).slice(1);
    if (inner.some((w) => w === "не" || w === "нет")) return true;
  }
  const after = clause.slice(end).split(/\s+/).filter(Boolean).slice(0, 3);
  if (after[0] === "нет" || after[1] === "нет") return true;
  if (after[0] === "не" && /^был/.test(after[1] ?? "")) return true;
  if (after.some((w) => w.startsWith("отсутству"))) return true;
  return false;
}

/** Явно описанные тревожные признаки с учётом отрицаний («отёка нет»). */
export function detectRedFlags(text: string): RedFlag[] {
  const found = new Set<RedFlag>();
  for (const clause of clauses(text)) {
    for (const flag of RED_FLAGS) {
      for (const pattern of FLAG_PATTERNS[flag]) {
        const re = new RegExp(pattern.re.source, "g");
        for (const m of clause.matchAll(re)) {
          if (!isNegated(clause, m.index, m.index + m[0].length, pattern)) {
            found.add(flag);
          }
        }
      }
    }
  }
  return RED_FLAGS.filter((f) => found.has(f));
}

/** Травма: «yes» — описана, «no» — прямо отрицается, undefined — неизвестно. */
export function detectTrauma(text: string): "yes" | "no" | undefined {
  const parts = clauses(text);
  if (parts.some(deniesTrauma)) return "no";
  for (const clause of parts) {
    const pattern: Pattern = {
      re: /упал\S*|падени\S*|ударил\S*|удар[ау]?(?![а-я])|ударом|ушиб\S*|подвернул\S*|подвихнул\S*|травм\S*|вывих\S*|растянул\S*|растяжени\S*|споткнул\S*|поскользнул\S*|сломал\S*|перелом\S*|(?<![а-я])дтп(?![а-я])|авари\S*/g,
    };
    for (const m of clause.matchAll(pattern.re)) {
      if (!isNegated(clause, m.index, m.index + m[0].length, pattern))
        return "yes";
    }
  }
  return undefined;
}

/** Прямое отрицание травмы внутри одной фразы. */
function deniesTrauma(norm: string): boolean {
  return (
    /без\s+(?:\S+\s+)?(?:травм|удар|падени|видим\S*\s+причин|причин)\S*/.test(
      norm,
    ) ||
    /(?:травм|удар|падени)\S*\s+(?:\S+\s+)?(?:не\s+было|не\s+получал\S*|нет)(?![а-я])/.test(
      norm,
    ) ||
    /не\s+(?:падал\S*|ударял\S*|ударил\S*|травмировал\S*|подворачивал\S*)/.test(
      norm,
    ) ||
    /сам\S*\s+по\s+себе|ни\s+с\s+того\s+ни\s+с\s+сего/.test(norm)
  );
}

const NUMBER_WORD = String.raw`(?:\d+|одн\S*|один|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|несколько|пар\S*|полтор\S*)`;
const UNIT = String.raw`(?:минут\S*|час\S*|дн\S*|день|сут\S*|недел\S*|месяц\S*|год\S*|лет)`;

/** Сколько длится проблема — как написал пациент (без толкования). */
export function detectDuration(text: string): string | undefined {
  const norm = normalizeForRules(text);
  const m =
    norm.match(new RegExp(String.raw`${NUMBER_WORD}\s*${UNIT}`)) ??
    norm.match(new RegExp(String.raw`${UNIT}\s+${NUMBER_WORD}`)) ??
    norm.match(
      /(?:со\s+)?вчера\S*|с\s+утра|сегодня\s+утром|с\s+вечера|позавчера|(?:уже\s+)?(?:неделю|месяц|год)|давно|недавно|пару\s+дней/,
    );
  return m
    ? m[0]
        .replace(/[,.;!?]+$/, "")
        .trim()
        .slice(0, 40)
    : undefined;
}

/** Просьба о лекарствах, лечении, диагнозе или оценке опасности. */
export function isMedicalAdviceRequest(text: string): boolean {
  const norm = normalizeForRules(text);
  return [
    new RegExp(
      String.raw`(?:что|чем|какие|какое|какую|каким)\s+${W}{0,2}(?:выпить|пить|принимать|принять|лечить|лечиться|полечить|мазать|намазать|колоть|капать|полоскать|снять\s+боль)`,
    ),
    new RegExp(
      String.raw`(?:какие|какое|какую|какой)\s+${W}?(?:таблетк\S*|лекарств\S*|препарат\S*|антибиотик\S*|мазь|капли|обезболивающ\S*)`,
    ),
    /дозировк\S*|сколько\s+(?:\S+\s+)?(?:таблет\S*|капель|мг)/,
    new RegExp(
      String.raw`можно\s+(?:ли\s+)?${W}{0,2}(?:пить|принимать|выпить|мазать|греть|прикладывать)(?![а-я])`,
    ),
    new RegExp(
      String.raw`(?:что|какой|какая)\s+${W}?(?:у\s+меня|это)\s+(?:за\s+)?(?:болезн\S*|диагноз\S*|заболевани\S*)`,
    ),
    /(?:поставь\S*|скаж\S*|назов\S*)\s+(?:\S+\s+)?диагноз/,
    /(?<![а-я])это\s+(?:\S+\s+)?(?:опасно|серьезно|страшно|нормально)(?![а-я])/,
    /(?:расшифр\S*|посмотр\S*|оцен\S*)\s+(?:\S+\s+)?(?:анализ\S*|снимок|снимки|мрт|кт|узи|рентген\S*)/,
    /(?:чем|как)\s+(?:\S+\s+)?лечить/,
  ].some((re) => re.test(norm));
}

/** Срочность по известным фактам. Без признаков — «none», а не «безопасно». */
export function urgencyOf(facts: {
  redFlags: readonly RedFlag[];
  trauma?: "yes" | "no";
}): Urgency {
  if (facts.redFlags.some((f) => ALWAYS_EMERGENCY.includes(f)))
    return "emergency";
  if (facts.redFlags.includes("severe_swelling"))
    return facts.trauma === "yes" ? "emergency" : "soon";
  if (facts.trauma === "yes") return "soon";
  return "none";
}

const UNSAFE_REPLY = [
  // Лекарства, дозировки, процедуры.
  /\d+\s*(?:мг|мл|таб|капел)/,
  /(?:принимайте|примите|выпейте|пейте|попейте|мажьте|намажьте|прикладывайте|приложите|наложите|полощите|капайте|колите|сделайте\s+компресс)/,
  /(?:таблетк|ибупрофен|парацетамол|нурофен|анальгин|антибиотик|обезболивающ|мазь|диклофенак|кетопрофен|найз|аспирин|кеторол)/,
  // Диагнозы и ложное успокоение.
  /(?:у\s+вас|это)\s+(?:скорее\s+всего|вероятно|наверное|похоже|точно|явно)(?![а-я])/,
  /(?:ничего\s+страшного|не\s+опасно|не\s+о\s+чем\s+беспокоиться|не\s+стоит\s+беспокоиться|пройдет\s+само|ничего\s+серьезного)/,
  // Выдуманные данные: время и цены показывает программа из справочника.
  /\b(?:[01]?\d|2[0-3])[:.][0-5]\d\b/,
  /\d[\d\s]*(?:₽|руб)/,
];

/** Ответ модели нельзя показывать: советы по лечению, диагнозы, выдуманные цены и время. */
export function isUnsafeReply(text: string): boolean {
  const norm = normalizeForRules(text);
  return UNSAFE_REPLY.some((re) => re.test(norm));
}

export const EMERGENCY_TEXT =
  "То, что вы описываете, может требовать срочной медицинской помощи. " +
  "Пожалуйста, не ждите записи: позвоните 103 (скорая помощь) или 112 (единый номер экстренных служб) " +
  "либо сразу обратитесь в ближайший травмпункт или приёмное отделение.\n" +
  "Бот не может оценить ваше состояние. Если нужно, позову администратора клиники.";

export const SOON_TEXT =
  "После травмы лучше показаться врачу как можно раньше, не откладывая. " +
  "Если появится сильный отёк, деформация, станет невозможно наступить или опереться — сразу звоните 103 или 112.";

export const EMERGENCY_REMINDER =
  "Напоминаю: при признаках, о которых вы писали, сначала обратитесь за срочной помощью — 103 или 112.";

export const MEDICAL_ADVICE_REFUSAL =
  "Я не ставлю диагнозы, не оцениваю, опасно ли состояние, и не советую лекарства или лечение — это может сделать только врач на очном приёме. " +
  "Могу помочь подобрать специалиста и записаться. Если состояние резко ухудшается — звоните 103 или 112.";
