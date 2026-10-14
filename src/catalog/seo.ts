import type { Maturity, Solution } from "@/catalog/schema";

const TITLE_SUFFIX: Record<Maturity, string> = {
  demo: "",
  concept: " (концепция)",
  in_development: " (в разработке)",
};

/** Статус ставится в начало описания, чтобы он не обрезался в выдаче. */
const DESCRIPTION_PREFIX: Record<Maturity, string> = {
  demo: "",
  concept: "Концепция, готового продукта нет. ",
  in_development: "В разработке, не готово к промышленной эксплуатации. ",
};

/**
 * Заголовок страницы решения для поиска. Концепции и продукты в разработке
 * помечаются прямо в заголовке — в выдаче они не выглядят готовыми продуктами.
 */
export function solutionSeoTitle(solution: Solution): string {
  return solution.title + TITLE_SUFFIX[solution.maturity];
}

export function solutionSeoDescription(solution: Solution): string {
  return DESCRIPTION_PREFIX[solution.maturity] + solution.summary;
}
