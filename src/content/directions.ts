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
    description: "ИИ-функции в CRM: сводки по клиентам и подсказки менеджерам.",
    icon: "chart",
    query: { q: "CRM" },
  },
  {
    id: "documents",
    title: "Документооборот",
    description: "Извлечение данных из счетов, накладных и актов.",
    icon: "document",
    query: { categories: ["document-processing"] },
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
};
