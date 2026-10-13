import type { Solution } from "@/catalog/schema";

/** Состояние каталога, которое хранится в URL. */
export type CatalogQuery = {
  q: string;
  categories: string[];
  industries: string[];
};

export const EMPTY_QUERY: CatalogQuery = {
  q: "",
  categories: [],
  industries: [],
};

/** Имена параметров URL: ?q=…&category=a&category=b&industry=x */
export const QUERY_PARAMS = {
  q: "q",
  category: "category",
  industry: "industry",
} as const;

const MAX_QUERY_LENGTH = 100;

type RawParams = Record<string, string | string[] | undefined>;

function readAll(params: RawParams, key: string): string[] {
  const value = params[key];
  const list =
    value === undefined ? [] : Array.isArray(value) ? value : [value];
  // Поддерживаем и повторяющиеся параметры, и значения через запятую.
  return list.flatMap((v) => v.split(","));
}

/** Оставляет только известные id без повторов, в порядке справочника. */
function pickKnown(values: string[], knownIds: readonly string[]): string[] {
  const requested = new Set(values.map((v) => v.trim()));
  return knownIds.filter((id) => requested.has(id));
}

/**
 * Разбирает параметры URL. Неизвестные категории и отрасли отбрасываются,
 * строка поиска обрезается по краям и по длине.
 */
export function parseCatalogQuery(
  params: RawParams,
  known: { categoryIds: readonly string[]; industryIds: readonly string[] },
): CatalogQuery {
  const rawQ = params[QUERY_PARAMS.q];
  const q = (Array.isArray(rawQ) ? rawQ[0] : rawQ) ?? "";
  return {
    q: q.trim().slice(0, MAX_QUERY_LENGTH),
    categories: pickKnown(
      readAll(params, QUERY_PARAMS.category),
      known.categoryIds,
    ),
    industries: pickKnown(
      readAll(params, QUERY_PARAMS.industry),
      known.industryIds,
    ),
  };
}

/** Строка параметров для URL; пустые значения не попадают в адрес. */
export function serializeCatalogQuery(query: CatalogQuery): string {
  const params = new URLSearchParams();
  const q = query.q.trim();
  if (q) params.set(QUERY_PARAMS.q, q);
  for (const id of query.categories) params.append(QUERY_PARAMS.category, id);
  for (const id of query.industries) params.append(QUERY_PARAMS.industry, id);
  return params.toString();
}

/** Адрес каталога с заданным состоянием. */
export function catalogHref(query: CatalogQuery): string {
  const search = serializeCatalogQuery(query);
  return search ? `/catalog?${search}` : "/catalog";
}

export function isQueryEmpty(query: CatalogQuery): boolean {
  return (
    query.q.trim() === "" &&
    query.categories.length === 0 &&
    query.industries.length === 0
  );
}

/** Добавляет или убирает значение из списка. */
export function toggleValue(list: readonly string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

/** Нормализация для поиска: регистр, «ё», лишние пробелы. */
export function normalizeText(text: string): string {
  return text.toLowerCase().replaceAll("ё", "е").replace(/\s+/g, " ").trim();
}

function matchesText(solution: Solution, q: string): boolean {
  const words = normalizeText(q).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalizeText(
    [solution.title, solution.summary, solution.description].join(" "),
  );
  return words.every((word) => haystack.includes(word));
}

/**
 * Фильтрация каталога.
 * - Поиск: все слова запроса должны встречаться в названии или описании.
 * - Внутри категорий и внутри отраслей — «или», между группами — «и».
 * - Решение с пустым industryIds подходит для любой отрасли.
 */
export function filterSolutions(
  solutions: readonly Solution[],
  query: CatalogQuery,
): Solution[] {
  return solutions.filter((solution) => {
    if (!matchesText(solution, query.q)) return false;
    if (
      query.categories.length > 0 &&
      !solution.categoryIds.some((id) => query.categories.includes(id))
    ) {
      return false;
    }
    if (
      query.industries.length > 0 &&
      solution.industryIds.length > 0 &&
      !solution.industryIds.some((id) => query.industries.includes(id))
    ) {
      return false;
    }
    return true;
  });
}

/** Склонение: 1 решение, 2 решения, 5 решений. */
export function pluralRu(
  n: number,
  forms: readonly [one: string, few: string, many: string],
): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}
