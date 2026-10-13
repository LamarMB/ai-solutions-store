import { z } from "zod";
import {
  addDuplicateIssues,
  CategorySchema,
  IndustrySchema,
  SolutionSchema,
} from "@/catalog/schema";

/** Каталог целиком: уникальность id и ссылочная целостность. */
export const CatalogSchema = z
  .strictObject({
    categories: z.array(CategorySchema),
    industries: z.array(IndustrySchema),
    solutions: z.array(SolutionSchema),
  })
  .superRefine((catalog, ctx) => {
    addDuplicateIssues(
      ctx,
      catalog.categories.map((c) => c.id),
      ["categories"],
      "id категории",
    );
    addDuplicateIssues(
      ctx,
      catalog.industries.map((i) => i.id),
      ["industries"],
      "id отрасли",
    );
    addDuplicateIssues(
      ctx,
      catalog.solutions.map((s) => s.id),
      ["solutions"],
      "id решения",
    );

    const categoryIds = new Set(catalog.categories.map((c) => c.id));
    const industryIds = new Set(catalog.industries.map((i) => i.id));

    catalog.solutions.forEach((solution, s) => {
      solution.categoryIds.forEach((id, i) => {
        if (!categoryIds.has(id)) {
          ctx.addIssue({
            code: "custom",
            message: `Решение "${solution.id}" ссылается на несуществующую категорию "${id}"`,
            path: ["solutions", s, "categoryIds", i],
          });
        }
      });
      solution.industryIds.forEach((id, i) => {
        if (!industryIds.has(id)) {
          ctx.addIssue({
            code: "custom",
            message: `Решение "${solution.id}" ссылается на несуществующую отрасль "${id}"`,
            path: ["solutions", s, "industryIds", i],
          });
        }
      });
    });
  });

export type Catalog = z.infer<typeof CatalogSchema>;
export type CatalogInput = z.input<typeof CatalogSchema>;

/** Проверяет каталог; при ошибке бросает исключение с понятным списком проблем. */
export function parseCatalog(input: CatalogInput): Catalog {
  const result = CatalogSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `Каталог содержит ошибки:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
