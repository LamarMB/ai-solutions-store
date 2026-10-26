import { formatDuration, REQUEST_PARAMS } from "@/catalog/links";
import type { Solution } from "@/catalog/schema";
import { Icon } from "@/components/ui/Icon";
import { PackagePrice } from "@/components/ui/PackagePrice";
import { cn } from "@/lib/cn";

/**
 * Выбор пакета — нативная группа радиокнопок внутри GET-формы.
 * Отправка ведёт на /request?solution=…&package=…; работает без JavaScript,
 * стрелки клавиатуры переключают пакет. Данные не отправляются и не хранятся.
 */
export function PackagePicker({
  solution,
  defaultPackageId,
}: {
  solution: Solution;
  defaultPackageId: string;
}) {
  const columns =
    solution.packages.length >= 3 ? "lg:grid-cols-3" : "md:grid-cols-2";

  return (
    <form action="/request" method="get" aria-labelledby="packages-title">
      <input type="hidden" name={REQUEST_PARAMS.solution} value={solution.id} />
      <fieldset>
        <legend className="sr-only">Выберите пакет</legend>
        <div className={cn("grid gap-4", columns)}>
          {solution.packages.map((pkg) => (
            <label
              key={pkg.id}
              className={cn(
                "group rounded-card border-border bg-surface relative flex cursor-pointer flex-col border p-5 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] transition-colors duration-200 sm:p-6",
                "hover:border-border-strong",
                "has-checked:border-accent has-checked:bg-accent-soft/40 has-checked:shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_0_0_1px_var(--accent)]",
                "has-focus-visible:outline-accent has-focus-visible:outline-2 has-focus-visible:outline-offset-2",
              )}
            >
              <input
                type="radio"
                name={REQUEST_PARAMS.package}
                value={pkg.id}
                defaultChecked={pkg.id === defaultPackageId}
                className="sr-only"
              />
              <div className="flex items-start justify-between gap-4">
                <div>
                  {pkg.recommended && (
                    <p className="text-caption text-accent mb-1 font-semibold tracking-wide uppercase">
                      Рекомендуем
                    </p>
                  )}
                  <h3 className="text-h3 font-semibold">{pkg.title}</h3>
                </div>
                {/* Индикатор выбора, как у радиокнопки */}
                <span
                  aria-hidden="true"
                  className="border-border-strong group-has-checked:border-accent group-has-checked:bg-accent text-accent-ink mt-1 grid size-6 shrink-0 place-items-center rounded-full border"
                >
                  <Icon
                    name="check"
                    size={14}
                    className="hidden group-has-checked:block"
                  />
                </span>
              </div>
              <p className="text-small text-muted mt-2">{pkg.summary}</p>

              <div className="mt-5">
                <PackagePrice pkg={pkg} size="lg" />
                {pkg.duration && (
                  <p className="text-caption text-muted mt-1">
                    Ориентировочный срок: {formatDuration(pkg.duration)}
                  </p>
                )}
              </div>

              <div className="border-border mt-5 border-t pt-4">
                <p className="text-caption text-muted font-semibold tracking-wide uppercase">
                  Состав работ
                </p>
                <ul className="mt-3 grid gap-2">
                  {pkg.includes.map((item) => (
                    <li key={item} className="text-small flex gap-2.5">
                      <Icon
                        name="check"
                        size={16}
                        className="text-accent mt-0.5 shrink-0"
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-caption text-muted max-w-prose">
          {solution.pricingNote ??
            "Цены и сроки демонстрационные и ориентировочные."}{" "}
          Окончательный состав и стоимость определяются после обсуждения задачи.
        </p>
        <button
          type="submit"
          className="liquid-primary rounded-control text-body inline-flex h-13 shrink-0 items-center justify-center gap-2 px-6 font-medium"
        >
          Форма заявки (тест)
          <Icon name="arrow-right" size={18} />
        </button>
      </div>
    </form>
  );
}
