import { parseCatalog } from "@/catalog/catalog";
import { categories } from "@/content/categories";
import { industries } from "@/content/industries";
import { solutions } from "@/content/solutions";

/** Каталог проверяется схемой при первом импорте: ошибка в данных ломает сборку и тесты. */
export const catalog = parseCatalog({ categories, industries, solutions });

const publicSolutions = catalog.solutions.filter((s) => !s.hidden);
const usedCategoryIds = new Set(publicSolutions.flatMap((s) => s.categoryIds));
const usedIndustryIds = new Set(publicSolutions.flatMap((s) => s.industryIds));

/**
 * Публичные решения — всё, что видит посетитель: каталог, страницы, консультант,
 * заявка, sitemap. Скрытые (`hidden`) записи сюда не попадают.
 */
export function getSolutions() {
  return publicSolutions;
}

/** Все записи, включая скрытые, — для проверок данных и тестов. */
export function getAllSolutions() {
  return catalog.solutions;
}

export function getSolutionById(id: string) {
  return publicSolutions.find((s) => s.id === id);
}

/** Категории, в которых есть публичные решения (в порядке справочника). */
export function getCategories() {
  return catalog.categories.filter((c) => usedCategoryIds.has(c.id));
}

/** Отрасли, к которым относятся публичные решения (в порядке справочника). */
export function getIndustries() {
  return catalog.industries.filter((i) => usedIndustryIds.has(i.id));
}

export function getSolutionsByCategory(categoryId: string) {
  return publicSolutions.filter((s) => s.categoryIds.includes(categoryId));
}

/** Решения для отрасли, включая применимые к любой отрасли (пустой industryIds). */
export function getSolutionsByIndustry(industryId: string) {
  return publicSolutions.filter(
    (s) => s.industryIds.length === 0 || s.industryIds.includes(industryId),
  );
}

export type * from "@/catalog/schema";
export { formatPrice, getPriceParts, getStartingPrice } from "@/catalog/price";
