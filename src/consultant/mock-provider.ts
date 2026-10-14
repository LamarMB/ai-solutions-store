import { formatDuration } from "@/catalog/links";
import { formatPrice } from "@/catalog/price";
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
 * Сопоставляет ключевые слова с задачами и отраслями и рекомендует
 * только решения из переданного каталога.
 */

type Topic = {
  id: string;
  label: string;
  stems: string[];
  solutionIds: string[];
};

/** Задачи → решения каталога (id проверяются тестом). */
export const MOCK_TOPICS: Topic[] = [
  {
    id: "inbound",
    label: "обработка обращений клиентов",
    stems: [
      "обращен",
      "чат",
      "бот",
      "ассистент",
      "администратор",
      "звонк",
      "запис",
      "пациент",
      "поддержк",
      "типов вопрос",
      "отвечать",
      "консультир",
    ],
    solutionIds: ["clinic-ai-administrator"],
  },
  {
    id: "documents",
    label: "обработка документов",
    stems: [
      "документ",
      "счет",
      "накладн",
      "скан",
      "pdf",
      "распозна",
      "бухгалт",
      "учетн",
      "1с",
      "реквизит",
      "первичк",
    ],
    solutionIds: ["document-data-extraction"],
  },
  {
    id: "crm",
    label: "продажи и CRM",
    stems: [
      "crm",
      "црм",
      "продаж",
      "менеджер",
      "лид",
      "воронк",
      "сделк",
      "клиентск баз",
      "битрикс",
      "amocrm",
    ],
    solutionIds: ["crm-ai-integration"],
  },
];

/** Отрасли → ключевые слова (id проверяются тестом). */
export const MOCK_INDUSTRY_STEMS: Record<string, string[]> = {
  healthcare: ["клиник", "медиц", "врач", "пациент", "стоматолог", "медцентр"],
  retail: [
    "магазин",
    "розниц",
    "маркетплейс",
    "e-commerce",
    "ecommerce",
    "товар",
  ],
  logistics: ["логист", "перевоз", "склад", "доставк", "транспорт", "экспедир"],
  manufacturing: ["производств", "завод", "цех", "предприят"],
  "professional-services": ["консалтинг", "юрид", "юрист", "агентств", "аудит"],
  education: ["обучен", "школ", "курс", "образован", "студент", "учебн"],
};

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

export const EXAMPLE_TASKS = [
  "Клиника тратит много времени на звонки и запись пациентов",
  "Нужно быстрее вносить счета и накладные в учётную систему",
  "Менеджеры не успевают разбирать обращения в CRM",
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

    if (ranked.length > 0) {
      const industryNote =
        industryIds.length > 0
          ? ` с учётом отрасли «${industryIds.map(industryTitle).join("», «")}»`
          : "";
      return {
        text:
          `Похоже, ваша задача — ${(recentTopics.length > 0 ? recentTopics : topics).map((t) => t.label).join(" и ")}. ` +
          `В каталоге есть подходящие решения${industryNote}. ` +
          "Посмотрите карточки ниже: у каждого решения — пакеты, состав работ и ограничения.",
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
          "Какую задачу хотите решить? Например, обработка обращений клиентов, работа с документами или продажи в CRM.",
        recommendations: [],
        followUps: [
          "Много повторяющихся обращений клиентов",
          "Долго обрабатываем документы",
          "Хотим помочь менеджерам по продажам",
        ],
      };
    }

    const greeting = has(last, INTENTS.greeting) ? "Здравствуйте! " : "";
    const unmatched = userTexts.length > 1 && !greeting;
    return {
      text: unmatched
        ? "Не нашёл в каталоге решения под эту задачу. Попробуйте описать её иначе — какой процесс занимает больше всего времени? " +
          "Если подходящего решения нет, можно отправить общую заявку."
        : `${greeting}Опишите задачу своими словами: какой процесс хотите ускорить или автоматизировать и в какой отрасли работаете.`,
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
        entry.score += recentTopics.includes(topic) ? 6 : 3;
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
        entry.reasons.push(
          "ваша отрасль не указана среди отраслей решения — уточните применимость",
        );
      }
    }
    return [...scored.values()].sort((a, b) => b.score - a.score);
  }

  private answerPrice(
    ranked: { solution: Solution; reasons: string[] }[],
  ): ProviderReply {
    const lines = ranked.map(({ solution }) => {
      const pkgs = solution.packages
        .map((p) => `«${p.title}» — ${formatPrice(p.price)}`)
        .join(", ");
      return `${solution.title}: ${pkgs}.`;
    });
    return {
      text:
        "Стоимость по пакетам из каталога (демонстрационные цены):\n" +
        lines.join("\n") +
        "\nОкончательная стоимость уточняется после обсуждения задачи.",
      recommendations: this.keep(ranked),
      followUps: ["Какие сроки внедрения?", "Что нужно от нас для внедрения?"],
    };
  }

  private answerTimeline(
    ranked: { solution: Solution; reasons: string[] }[],
  ): ProviderReply {
    const lines = ranked.map(({ solution }) => {
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
