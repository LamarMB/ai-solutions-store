import type { Maturity } from "@/catalog/schema";

/** Подпись статуса для плашки. demo не подписывается отдельно — у него плашка «Демо». */
export const MATURITY_LABELS: Record<Maturity, string | null> = {
  demo: null,
  concept: "Концепция",
  in_development: "В разработке",
};

/** Пояснение статуса для страницы решения и консультанта. */
export const MATURITY_NOTES: Record<Maturity, string | null> = {
  demo: null,
  concept:
    "Концепция: готового продукта нет. Состав работ, сроки и стоимость определяются после обсуждения задачи.",
  in_development:
    "В разработке: продукт не подтверждён как готовый к промышленной эксплуатации. Возможно обсуждение пилота.",
};

export function isReadyOffer(maturity: Maturity): boolean {
  return maturity === "demo";
}
