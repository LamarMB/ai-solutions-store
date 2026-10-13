import { parseCatalog } from "@/catalog/catalog";
import { categories } from "@/content/categories";
import { industries } from "@/content/industries";
import { solutions } from "@/content/solutions";

/** Каталог проверяется схемой при первом импорте: ошибка в данных ломает сборку и тесты. */
export const catalog = parseCatalog({ categories, industries, solutions });

export function getSolutions() {
  return catalog.solutions;
}

export function getSolutionById(id: string) {
  return catalog.solutions.find((s) => s.id === id);
}

export function getCategories() {
  return catalog.categories;
}

export function getIndustries() {
  return catalog.industries;
}

export function getSolutionsByCategory(categoryId: string) {
  return catalog.solutions.filter((s) => s.categoryIds.includes(categoryId));
}

/** Решения для отрасли, включая применимые к любой отрасли (пустой industryIds). */
export function getSolutionsByIndustry(industryId: string) {
  return catalog.solutions.filter(
    (s) => s.industryIds.length === 0 || s.industryIds.includes(industryId),
  );
}

export type * from "@/catalog/schema";
export { formatPrice, getStartingPrice } from "@/catalog/price";
