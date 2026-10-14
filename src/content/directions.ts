import type { CatalogQuery } from "@/catalog/search";
import type { IconName } from "@/components/ui/Icon";

export type Direction = {
  id: string;
  title: string;
  description: string;
  icon: IconName;
  /** Фильтр каталога, на который ведёт направление. */
  query: Partial<CatalogQuery>;
};

/**
 * Популярные направления на главной. Каждое ведёт в каталог с фильтром
 * по существующей категории, отрасли или поисковому запросу.
 */
export const directions = [
  {
    id: "healthcare",
    title: "Медицина и клиники",
    description: "Обработка обращений пациентов и помощь с записью на приём.",
    icon: "heart",
    query: { industries: ["healthcare"] },
  },
  {
    id: "sales",
    title: "Продажи и CRM",
    description:
      "Обработка входящих запросов, квалификация лидов и ИИ-функции в CRM.",
    icon: "chart",
    query: { categories: ["sales"] },
  },
  {
    id: "accounting",
    title: "Бухгалтерия",
    description:
      "Обработка первичных документов и поиск расхождений между ними.",
    icon: "calculator",
    query: { categories: ["accounting"] },
  },
  {
    id: "documents",
    title: "Документооборот",
    description:
      "Извлечение данных из документов, сверка и поиск по документации.",
    icon: "document",
    query: { categories: ["document-processing", "knowledge-search"] },
  },
  {
    id: "hr",
    title: "HR и персонал",
    description:
      "Первичный отбор кандидатов и ответы сотрудникам на типовые вопросы.",
    icon: "users",
    query: { categories: ["hr"] },
  },
  {
    id: "restaurants",
    title: "Рестораны",
    description: "Приём заказов, ответы по меню и анализ данных о продажах.",
    icon: "utensils",
    query: { industries: ["restaurants"] },
  },
  {
    id: "retail",
    title: "Розница и e-commerce",
    description: "Решения для магазинов, интернет-магазинов и маркетплейсов.",
    icon: "bag",
    query: { industries: ["retail"] },
  },
  {
    id: "logistics",
    title: "Логистика",
    description: "Обработка транспортных документов и передача данных в учёт.",
    icon: "truck",
    query: { industries: ["logistics"] },
  },
  {
    id: "manufacturing",
    title: "Производство",
    description:
      "Извлечение данных из документов и автоматизация их обработки.",
    icon: "factory",
    query: { industries: ["manufacturing"] },
  },
] as const satisfies readonly Direction[];

/** Иконки отраслей для страницы «Отрасли». */
export const industryIcons: Record<string, IconName> = {
  retail: "bag",
  logistics: "truck",
  manufacturing: "factory",
  "professional-services": "briefcase",
  education: "book",
  healthcare: "heart",
  restaurants: "utensils",
};
