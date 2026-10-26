import { formatDuration } from "@/catalog/links";
import { formatPackagePrice } from "@/catalog/price";
import type { Industry, Solution } from "@/catalog/schema";
import { normalizeText } from "@/catalog/search";
import type {
  ChatProvider,
  ChatTurn,
  ProviderRecommendation,
  ProviderReply,
} from "@/consultant/types";

/**
 * Демонстрационный помощник на правилах — НЕ языковая модель.
 * Сопоставляет ключевые слова с задачами клиники и рекомендует
 * только решения из переданного каталога.
 */

type Topic = {
  id: string;
  label: string;
  stems: string[];
  solutionIds: string[];
};

/** Задачи клиники → решения каталога (id проверяются тестом). */
export const MOCK_TOPICS: Topic[] = [
  {
    id: "questions",
    label: "ответы пациентам на типовые вопросы",
    stems: [
      "вопрос",
      "звонк",
      "звонят",
      "чат",
      "бот",
      "ассистент",
      "администратор",
      "отвечать",
      "ответ",
      "круглосуточ",
      "ночь",
      "ночью",
      "нерабоч",
      "мессенджер",
    ],
    solutionIds: ["clinic-ai-administrator"],
  },
  {
    id: "booking",
    label: "запись на приём",
    stems: ["запис", "прием", "расписан", "перенос", "отмен", "регистратур"],
    solutionIds: ["clinic-ai-administrator", "patient-ai-assistant"],
  },
  {
    id: "routing",
    label: "разбор и распределение обращений",
    stems: [
      "обращен",
      "письм",
      "почт",
      "распредел",
      "маршрут",
      "отдел",
      "необработ",
      "теряют",
      "очеред",
      "сортир",
    ],
    solutionIds: ["patient-request-routing", "clinic-ai-administrator"],
  },
  {
    id: "patient-docs",
    label: "документы пациента и подготовка к приёму",
    stems: [
      "документ",
      "выписк",
      "назначен",
      "анкет",
      "истори",
      "медицинск карт",
      "подготовк к прием",
    ],
    solutionIds: ["patient-ai-assistant"],
  },
];

/** Отрасли → ключевые слова (id проверяются тестом). Сайт работает с клиниками. */
export const MOCK_INDUSTRY_STEMS: Record<string, string[]> = {
  healthcare: ["клиник", "медиц", "врач", "пациент", "стоматолог", "медцентр"],
};

/** Задачи вне медицинской тематики: честно говорим, что сейчас их не берём. */
export const OUT_OF_SCOPE_STEMS = [
  "ресторан",
  "кафе",
  "магазин",
  "маркетплейс",
  "производств",
  "завод",
  "склад",
  "логист",
  "бухгалт",
  "crm",
  "продаж",
  "ваканс",
  "резюме",
  "кадров",
  "hr",
  "школ",
];

/** Медицинские вопросы: консультант не ставит диагнозы и не назначает лечение. */
export const MEDICAL_ADVICE_STEMS = [
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
];

const INTENTS = {
  price: ["сколько", "стоит", "цена", "цены", "стоимост", "бюджет"],
  timeline: ["срок", "сколько времени", "когда будет", "как долго"],
  requirements: [
    "что нужно",
    "что потребуется",
    "данные нужн",
    "какие данные",
    "доступ",
    "требован",
  ],
  greeting: [
    "привет",
    "здравствуй",
    "добрый день",
    "добрый вечер",
    "доброе утро",
  ],
};

/**
 * Совпадение по началу слова («счет» → «счета»), чтобы основа не находилась
 * внутри других слов («акт» в «контакт»). Фразы с пробелом ищутся как есть.
 */
function has(text: string, stems: readonly string[]): boolean {
  const words = text.split(/[^a-zа-я0-9-]+/).filter(Boolean);
  return stems.some((stem) =>
    stem.includes(" ")
      ? text.includes(stem)
      : words.some((word) => word.startsWith(stem)),
  );
}

const MATURITY_REASON: Record<Solution["maturity"], string | null> = {
  demo: null,
  concept: "статус: концепция — готового продукта нет",
  in_development: "статус: в разработке — не готов к промышленной эксплуатации",
};

export const EXAMPLE_TASKS = [
  "Администраторы не успевают отвечать на звонки и сообщения пациентов",
  "Пациенты пишут ночью, а ответить некому",
  "Обращения пациентов теряются в общей почте",
];

export class MockChatProvider implements ChatProvider {
  readonly info = {
    id: "mock-rules",
    kind: "mock" as const,
    label: "Демонстрационный помощник",
  };

  constructor(
    private readonly solutions: readonly Solution[],
    private readonly industries: readonly Industry[],
  ) {}

  async reply(turns: readonly ChatTurn[]): Promise<ProviderReply> {
    const userTexts = turns
      .filter((t) => t.role === "user")
      .map((t) => normalizeText(t.text));
    const last = userTexts.at(-1) ?? "";
    const all = userTexts.join(" ");

    const topics = MOCK_TOPICS.filter((t) => has(all, t.stems));
    // Задачи из последнего сообщения важнее упомянутых раньше.
    const recentTopics = MOCK_TOPICS.filter((t) => has(last, t.stems));
    const industryIds = Object.entries(MOCK_INDUSTRY_STEMS)
      .filter(([, stems]) => has(all, stems))
      .map(([id]) => id);
    const industryTitle = (id: string) =>
      this.industries.find((i) => i.id === id)?.title ?? id;

    const ranked = this.rank(topics, industryIds, recentTopics);
    const top = ranked[0];

    // Вопросы о цене, сроках и требованиях — по уже найденным решениям,
    // только если в последнем сообщении нет новой задачи.
    if (top && recentTopics.length === 0) {
      if (has(last, INTENTS.price)) return this.answerPrice(ranked);
      if (has(last, INTENTS.timeline)) return this.answerTimeline(ranked);
      if (has(last, INTENTS.requirements))
        return this.answerRequirements(top.solution);
    }

    if (recentTopics.length === 0 && has(last, MEDICAL_ADVICE_STEMS)) {
      return {
        text:
          "Я помогаю клиникам подобрать решения для работы с пациентами и не даю медицинских советов: не ставлю диагнозы и не назначаю лечение. " +
          "С вопросами о здоровье обратитесь к врачу; при угрозе жизни звоните 103 или 112.",
        recommendations: [],
        followUps: EXAMPLE_TASKS,
      };
    }

    // Решаем по последнему сообщению: раньше в диалоге могла быть задача клиники.
    if (recentTopics.length === 0 && has(last, OUT_OF_SCOPE_STEMS)) {
      return {
        text:
          "Сейчас мы работаем только с частными медицинскими клиниками: общение с пациентами, запись на приём и обработка обращений. " +
          "Если ваша задача из этой области — опишите её, и я подскажу подходящее решение.",
        recommendations: [],
        followUps: EXAMPLE_TASKS,
      };
    }

    if (ranked.length > 0) {
      const industryNote =
        industryIds.length > 0
          ? ` с учётом отрасли «${industryIds.map(industryTitle).join("», «")}»`
          : "";
      return {
        text:
          `Похоже, ваша задача — ${(recentTopics.length > 0 ? recentTopics : topics).map((t) => t.label).join(" и ")}. ` +
          `В каталоге есть подходящие решения${industryNote}. ` +
          "Посмотрите карточки ниже: у каждого решения — состав работ и ограничения." +
          (ranked
            .slice(0, 3)
            .some(({ solution }) => solution.maturity !== "demo")
            ? " Обратите внимание: часть решений — концепции или продукт в разработке, а не готовые продукты; состав и стоимость по ним обсуждаются индивидуально."
            : ""),
        recommendations: ranked.map(({ solution, reasons }) => ({
          solutionId: solution.id,
          reason: reasons.join("; "),
        })),
        followUps: [
          "Сколько это стоит?",
          "Какие сроки внедрения?",
          "Что нужно от нас для внедрения?",
        ],
      };
    }

    if (industryIds.length > 0) {
      return {
        text:
          `Понял, отрасль — «${industryIds.map(industryTitle).join("», «")}». ` +
          "Какую задачу клиники хотите решить? Например, ответы пациентам, запись на приём или разбор обращений.",
        recommendations: [],
        followUps: EXAMPLE_TASKS,
      };
    }

    const greeting = has(last, INTENTS.greeting) ? "Здравствуйте! " : "";
    const unmatched = userTexts.length > 1 && !greeting;
    return {
      text: unmatched
        ? "Не нашёл в каталоге решения под эту задачу. Попробуйте описать её иначе — что в работе с пациентами занимает больше всего времени? " +
          "Если подходящего решения нет, напишите нам в Telegram — обсудим задачу."
        : `${greeting}Опишите задачу клиники своими словами: что в общении с пациентами, записи или обработке обращений хотите упростить.`,
      recommendations: [],
      followUps: EXAMPLE_TASKS,
    };
  }

  private rank(topics: Topic[], industryIds: string[], recentTopics: Topic[]) {
    const scored = new Map<
      string,
      { solution: Solution; score: number; reasons: string[] }
    >();
    for (const topic of topics) {
      for (const id of topic.solutionIds) {
        const solution = this.solutions.find((s) => s.id === id);
        if (!solution) continue;
        const entry = scored.get(id) ?? { solution, score: 0, reasons: [] };
        entry.score += recentTopics.includes(topic) ? 10 : 3;
        entry.reasons.push(`подходит под задачу: ${topic.label}`);
        scored.set(id, entry);
      }
    }
    for (const entry of scored.values()) {
      const { industryIds: own } = entry.solution;
      if (industryIds.length === 0) continue;
      if (own.length === 0) {
        entry.score += 1;
        entry.reasons.push("применимо в любой отрасли");
      } else if (own.some((id) => industryIds.includes(id))) {
        entry.score += 2;
        entry.reasons.push("ваша отрасль есть в списке отраслей решения");
      } else {
        entry.score -= 2;
        entry.reasons.push(
          "ваша отрасль не указана среди отраслей решения — уточните применимость",
        );
      }
    }
    // Концепции и разработки никогда не подаются как готовые продукты.
    for (const entry of scored.values()) {
      const note = MATURITY_REASON[entry.solution.maturity];
      if (note) entry.reasons.unshift(note);
    }
    return [...scored.values()].sort((a, b) => b.score - a.score);
  }

  private answerPrice(
    ranked: { solution: Solution; reasons: string[] }[],
  ): ProviderReply {
    const lines = ranked.map(({ solution }) => {
      if (solution.packages.length === 0) {
        return `${solution.title}: пакеты не сформированы, стоимость — по запросу.`;
      }
      const pkgs = solution.packages
        .map((p) => `«${p.title}» — ${formatPackagePrice(p)}`)
        .join(", ");
      return `${solution.title}: ${pkgs}.`;
    });
    const notes = [
      ...new Set(ranked.flatMap(({ solution }) => solution.pricingNote ?? [])),
    ];
    return {
      text:
        "Стоимость по тарифам из каталога:\n" +
        lines.join("\n") +
        (notes.length > 0 ? `\n${notes.join(" ")}` : "") +
        "\nОкончательная стоимость уточняется после обсуждения задачи.",
      recommendations: this.keep(ranked),
      followUps: ["Какие сроки внедрения?", "Что нужно от нас для внедрения?"],
    };
  }

  private answerTimeline(
    ranked: { solution: Solution; reasons: string[] }[],
  ): ProviderReply {
    const lines = ranked.map(({ solution }) => {
      if (solution.packages.length === 0) {
        return `${solution.title}: сроки определяются после обсуждения задачи.`;
      }
      const pkgs = solution.packages
        .map((p) =>
          p.duration
            ? `«${p.title}» — ориентировочно ${formatDuration(p.duration)}`
            : `«${p.title}» — срок определяется после обсуждения`,
        )
        .join(", ");
      return `${solution.title}: ${pkgs}.`;
    });
    return {
      text:
        "Сроки по пакетам из каталога (ориентировочные):\n" + lines.join("\n"),
      recommendations: this.keep(ranked),
      followUps: ["Сколько это стоит?", "Что нужно от нас для внедрения?"],
    };
  }

  private answerRequirements(solution: Solution): ProviderReply {
    return {
      text:
        `Для решения «${solution.title}» понадобится:\n` +
        solution.dataRequirements.map((d) => `• ${d}`).join("\n") +
        "\nДоступы:\n" +
        solution.accessRequirements.map((d) => `• ${d}`).join("\n") +
        "\nОграничения:\n" +
        solution.limitations.map((d) => `• ${d}`).join("\n"),
      recommendations: [
        {
          solutionId: solution.id,
          reason: "требования и ограничения — на странице решения",
        },
      ],
      followUps: ["Сколько это стоит?", "Какие сроки внедрения?"],
    };
  }

  private keep(
    ranked: { solution: Solution; reasons: string[] }[],
  ): ProviderRecommendation[] {
    return ranked.map(({ solution, reasons }) => ({
      solutionId: solution.id,
      reason: reasons.join("; "),
    }));
  }
}
