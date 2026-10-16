import { getStartingPrice } from "@/catalog/price";
import type { Maturity, Package, Price, Solution } from "@/catalog/schema";
import type { ProviderRecommendation } from "@/consultant/types";

/** Рекомендация для интерфейса: все данные — из каталога, не из ответа провайдера. */
export type RecommendationView = {
  solutionId: string;
  title: string;
  summary: string;
  isDemo: boolean;
  maturity: Maturity;
  reason: string;
  startingPrice: Price;
  packages: Pick<Package, "id" | "title" | "price" | "monthlyPrice">[];
};

const MAX_RECOMMENDATIONS = 3;
const REASON_MAX = 300;

/**
 * Оставляет только решения, которые есть в каталоге (без повторов),
 * и собирает карточки из данных каталога. Выдуманное провайдером отбрасывается.
 */
export function resolveRecommendations(
  recs: readonly ProviderRecommendation[],
  solutions: readonly Solution[],
): RecommendationView[] {
  const seen = new Set<string>();
  const result: RecommendationView[] = [];
  for (const rec of recs) {
    const solution = solutions.find((s) => s.id === rec.solutionId);
    if (!solution || seen.has(solution.id)) continue;
    seen.add(solution.id);
    result.push({
      solutionId: solution.id,
      title: solution.title,
      summary: solution.summary,
      isDemo: solution.isDemo,
      maturity: solution.maturity,
      reason: rec.reason.trim().slice(0, REASON_MAX),
      startingPrice: getStartingPrice(solution),
      packages: solution.packages.map((p) => ({
        id: p.id,
        title: p.title,
        price: p.price,
        ...(p.monthlyPrice ? { monthlyPrice: p.monthlyPrice } : {}),
      })),
    });
    if (result.length === MAX_RECOMMENDATIONS) break;
  }
  return result;
}
