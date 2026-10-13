import type { Duration, Solution } from "@/catalog/schema";
import { pluralRu } from "@/catalog/search";

/** Параметры адреса заявки: /request?solution=…&package=… */
export const REQUEST_PARAMS = {
  solution: "solution",
  package: "package",
} as const;

export function solutionHref(solutionId: string): string {
  return `/catalog/${encodeURIComponent(solutionId)}`;
}

/** Адрес будущей страницы заявки с выбранным решением и пакетом. */
export function requestHref(solutionId: string, packageId?: string): string {
  const params = new URLSearchParams({ [REQUEST_PARAMS.solution]: solutionId });
  if (packageId) params.set(REQUEST_PARAMS.package, packageId);
  return `/request?${params.toString()}`;
}

type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

/**
 * Разбирает выбор из адреса заявки и проверяет его по каталогу.
 * Неизвестное решение — null; неизвестный пакет отбрасывается.
 */
export function resolveRequestSelection(
  params: RawParams,
  solutions: readonly Solution[],
) {
  const solutionId = first(params[REQUEST_PARAMS.solution]);
  const solution = solutions.find((s) => s.id === solutionId);
  if (!solution) return null;
  const packageId = first(params[REQUEST_PARAMS.package]);
  const pkg = solution.packages.find((p) => p.id === packageId);
  return { solution, package: pkg };
}

const WEEKS = ["неделя", "недели", "недель"] as const;

/** «3–5 недель», «2 недели». Сроки ориентировочные. */
export function formatDuration({ minWeeks, maxWeeks }: Duration): string {
  return minWeeks === maxWeeks
    ? `${minWeeks} ${pluralRu(minWeeks, WEEKS)}`
    : `${minWeeks}–${maxWeeks} ${pluralRu(maxWeeks, WEEKS)}`;
}
