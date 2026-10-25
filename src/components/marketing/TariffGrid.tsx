import { requestHref } from "@/catalog/links";
import type { Solution } from "@/catalog/schema";
import { ButtonLink } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { PackagePrice } from "@/components/ui/PackagePrice";
import { cn } from "@/lib/cn";

/**
 * Тарифы решения: карточки пакетов с разовой и ежемесячной ценой.
 * Рекомендуемый тариф выделен; каждая карточка ведёт к заявке на этот тариф.
 */
export function TariffGrid({ solution }: { solution: Solution }) {
  return (
    <div>
      <ul className="grid gap-4 lg:grid-cols-3">
        {solution.packages.map((pkg) => (
          <li key={pkg.id} className="flex">
            <article
              aria-labelledby={`tariff-${pkg.id}`}
              className={cn(
                "rounded-card bg-surface relative flex w-full flex-col border p-5 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] sm:p-6",
                pkg.recommended
                  ? "border-accent bg-accent-soft/40 shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_0_0_1px_var(--accent)]"
                  : "border-border",
              )}
            >
              <p
                className={cn(
                  "text-caption mb-1 min-h-5 font-semibold tracking-wide uppercase",
                  pkg.recommended ? "text-accent" : "text-muted",
                )}
              >
                {pkg.recommended ? "Рекомендуем" : "Тариф"}
              </p>
              <h3 id={`tariff-${pkg.id}`} className="text-h3 font-semibold">
                {pkg.title}
              </h3>
              <p className="text-small text-muted mt-2">{pkg.summary}</p>
              <PackagePrice pkg={pkg} size="lg" className="mt-5" />
              <ul className="border-border mt-5 grid gap-2 border-t pt-4">
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
              <div className="mt-auto pt-6">
                <ButtonLink
                  href={requestHref(solution.id, pkg.id)}
                  variant={pkg.recommended ? "primary" : "secondary"}
                  className="w-full"
                >
                  Выбрать «{pkg.title}»
                </ButtonLink>
              </div>
            </article>
          </li>
        ))}
      </ul>
      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        <p className="rounded-card border-border text-small text-muted flex gap-3 border p-4">
          <Icon
            name="calendar"
            size={20}
            className="text-accent mt-0.5 shrink-0"
          />
          <span>
            <span className="text-ink font-medium">
              Как подтверждается запись.
            </span>{" "}
            Если расписание клиники ведётся в нашей панели, запись
            подтверждается сразу — пациент видит её в чате и в приложении.
            Синхронизация с МИС или другой системой расписания клиники
            оценивается отдельно.
          </span>
        </p>
        {solution.pricingNote && (
          <p className="rounded-card border-demo-ink/25 bg-demo-bg text-small text-demo-ink flex gap-3 border p-4">
            <Icon name="clock" size={20} className="mt-0.5 shrink-0" />
            <span>{solution.pricingNote}</span>
          </p>
        )}
      </div>
    </div>
  );
}
