import { z } from "zod";

/** Идентификатор-slug: строчные латинские буквы, цифры и дефисы. */
export const SlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Ожидается slug: a-z, 0-9 и дефисы");

const Text = z.string().trim().min(1, "Строка не может быть пустой");
const TextList = z.array(Text);
const NonEmptyTextList = TextList.min(1, "Нужен хотя бы один пункт");

/** Поддерживаемые валюты (ISO 4217). */
export const CurrencySchema = z.enum(["RUB"]);

/** Сумма в минимальных единицах валюты (копейках), целое положительное число. */
export const AmountSchema = z
  .int("Сумма должна быть целым числом в копейках")
  .positive("Сумма должна быть больше нуля");

/**
 * Цена: фиксированная, «от» (нижняя граница) или по запросу.
 * Вид цены — часть смысла и не должен теряться при обработке.
 */
export const PriceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("fixed"),
    amount: AmountSchema,
    currency: CurrencySchema,
  }),
  z.strictObject({
    kind: z.literal("from"),
    amount: AmountSchema,
    currency: CurrencySchema,
  }),
  z.strictObject({
    kind: z.literal("on_request"),
  }),
]);

/** Оценка сроков в неделях. */
export const DurationSchema = z
  .strictObject({
    minWeeks: z.int().positive(),
    maxWeeks: z.int().positive(),
  })
  .refine((d) => d.minWeeks <= d.maxWeeks, {
    message: "minWeeks не может быть больше maxWeeks",
    path: ["maxWeeks"],
  });

export const CategorySchema = z.strictObject({
  id: SlugSchema,
  title: Text,
  description: Text,
});

export const IndustrySchema = z.strictObject({
  id: SlugSchema,
  title: Text,
  description: Text,
});

/** Пакет решения. Позиция будущей заявки — пара (solutionId, packageId). */
export const PackageSchema = z.strictObject({
  id: SlugSchema,
  title: Text,
  summary: Text,
  price: PriceSchema,
  /** Состав работ пакета. */
  includes: NonEmptyTextList,
  duration: DurationSchema.optional(),
});

export const ImplementationStageSchema = z.strictObject({
  title: Text,
  description: Text,
});

export const SolutionSchema = z
  .strictObject({
    id: SlugSchema,
    /** Демонстрационная запись. Обязательное поле, значения по умолчанию нет. */
    isDemo: z.boolean(),
    title: Text,
    summary: Text,
    description: Text,
    categoryIds: z.array(SlugSchema).min(1, "Нужна хотя бы одна категория"),
    /** Пустой массив означает: решение применимо к любой отрасли. */
    industryIds: z.array(SlugSchema),
    packages: z.array(PackageSchema).min(1, "Нужен хотя бы один пакет"),
    implementationStages: z
      .array(ImplementationStageSchema)
      .min(1, "Нужен хотя бы один этап внедрения"),
    /** Какие данные нужны от заказчика. */
    dataRequirements: NonEmptyTextList,
    /** Какие доступы нужны от заказчика. */
    accessRequirements: NonEmptyTextList,
    limitations: NonEmptyTextList,
    tags: TextList,
  })
  .superRefine((solution, ctx) => {
    addDuplicateIssues(
      ctx,
      solution.packages.map((p) => p.id),
      ["packages"],
      "id пакета",
    );
    addDuplicateIssues(ctx, solution.categoryIds, ["categoryIds"], "категория");
    addDuplicateIssues(ctx, solution.industryIds, ["industryIds"], "отрасль");
  });

/** Добавляет ошибку для каждого повторяющегося значения. */
export function addDuplicateIssues(
  ctx: z.RefinementCtx,
  values: readonly string[],
  path: (string | number)[],
  label: string,
) {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({
        code: "custom",
        message: `Повторяется ${label}: "${value}"`,
        path: [...path, index],
      });
    }
    seen.add(value);
  });
}

export type Currency = z.infer<typeof CurrencySchema>;
export type Price = z.infer<typeof PriceSchema>;
export type Duration = z.infer<typeof DurationSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type Industry = z.infer<typeof IndustrySchema>;
export type Package = z.infer<typeof PackageSchema>;
export type ImplementationStage = z.infer<typeof ImplementationStageSchema>;
export type Solution = z.infer<typeof SolutionSchema>;

/** Входной тип для файлов данных (до проверки схемой). */
export type SolutionInput = z.input<typeof SolutionSchema>;
export type CategoryInput = z.input<typeof CategorySchema>;
export type IndustryInput = z.input<typeof IndustrySchema>;
