import type { CSSProperties } from "react";
import type { Solution } from "@/catalog/schema";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icon";
import { PackagePrice } from "@/components/ui/PackagePrice";
import { headerActions } from "@/config/navigation";
import { externalLinkProps } from "@/config/contact";
import { cn } from "@/lib/cn";
import { SectionIntro } from "./SectionIntro";

/**
 * Тарифы ИИ-администратора из каталога. Цены — только через PackagePrice;
 * кнопки ведут к разделу демонстрации, а не к тестовой форме заявки.
 */
export function Pricing({ solution }: { solution: Solution }) {
  return (
    <section
      id="tariffs"
      aria-labelledby="tariffs-title"
      className="scroll-mt-24 py-16 md:py-24 xl:py-28"
    >
      <Container>
        <SectionIntro
          id="tariffs-title"
          eyebrow="Тарифы"
          title="Внедрение один раз, обслуживание — ежемесячно"
          text="«Старт» — ответы в сообщениях сообщества ВКонтакте. «Оптимум» добавляет запись в чате и приложении клиники, расписание и роли сотрудников в панели. Состав уточняем на демонстрации."
        />
        <ul
          aria-label="Тарифы"
          className="-mx-4 mt-14 flex snap-x snap-mandatory [scrollbar-width:none] gap-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0 lg:pb-0"
        >
          {solution.packages.map((pkg, i) => (
            <li
              key={pkg.id}
              data-reveal
              style={{ "--reveal-i": i } as CSSProperties}
              className={cn(
                "panel relative flex w-[86%] max-w-sm shrink-0 snap-center flex-col p-8 sm:w-[60%] lg:w-auto lg:max-w-none",
                pkg.recommended &&
                  "border-accent/50 bg-surface shadow-[0_30px_60px_-30px_rgb(0_0_0/0.9)]",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-h2 font-semibold">{pkg.title}</h3>
                {pkg.recommended && (
                  <span className="bg-accent text-accent-ink text-caption rounded-full px-3 py-1 font-semibold">
                    Рекомендуем
                  </span>
                )}
              </div>
              <p className="text-muted mt-3 min-h-[3lh] text-pretty">
                {pkg.summary}
              </p>
              <PackagePrice
                pkg={pkg}
                size="lg"
                className="border-border mt-6 border-t pt-6"
              />
              <ul className="mt-7 flex-1 space-y-3">
                {pkg.includes.map((item) => (
                  <li key={item} className="text-small flex gap-3">
                    <Icon
                      name="check"
                      size={18}
                      className="text-accent mt-0.5 shrink-0"
                    />
                    <span className="text-ink/90">{item}</span>
                  </li>
                ))}
              </ul>
              <ButtonLink
                href={headerActions.demo.href}
                {...externalLinkProps}
                variant={pkg.recommended ? "primary" : "secondary"}
                className="mt-8"
              >
                Обсудить на демонстрации
              </ButtonLink>
            </li>
          ))}
        </ul>
        {solution.pricingNote && (
          <p className="text-small text-muted mt-6 flex items-start gap-2">
            <Icon name="info" size={18} className="mt-0.5 shrink-0" />
            {solution.pricingNote}
          </p>
        )}
      </Container>
    </section>
  );
}
