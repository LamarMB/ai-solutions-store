import type { Metadata } from "next";
import { CtaPanel } from "@/components/marketing/CtaPanel";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { PriceTag } from "@/components/ui/PriceTag";
import { Section } from "@/components/ui/Section";
import { processSteps } from "@/content/approach";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Как проходит внедрение ИИ в клинике",
  description:
    "Этапы внедрения ИИ в клинике: анализ задачи, подбор решения и тарифа, тестовый запуск, поддержка. Что нужно от клиники на каждом этапе.",
  path: "/how-we-work",
});

const priceKinds = [
  {
    price: { kind: "fixed", amount: 15000000, currency: "RUB" },
    title: "Фиксированная цена",
    text: "Стоимость пакета при согласованном составе работ.",
  },
  {
    price: { kind: "from", amount: 15000000, currency: "RUB" },
    title: "Цена «от»",
    text: "Нижняя граница: итог зависит от объёма и уточняется после анализа.",
  },
  {
    price: { kind: "on_request" },
    title: "По запросу",
    text: "Объём индивидуальный, стоимость рассчитывается после обсуждения задачи.",
  },
] as const;

export default function HowWeWorkPage() {
  return (
    <Section className="pt-8 md:pt-12 xl:pt-14">
      <Breadcrumbs
        items={[{ label: "Главная", href: "/" }, { label: "Как мы работаем" }]}
      />
      <header className="mt-8 max-w-prose">
        <h1 className="text-h1 font-semibold">Как мы работаем</h1>
        <p className="text-muted mt-4">
          Внедрение идёт по четырём шагам. На каждом понятно, что происходит,
          что нужно от вас и чем шаг заканчивается.
        </p>
      </header>

      <ol className="mt-12 grid gap-6">
        {processSteps.map((step, index) => (
          <li key={step.id}>
            <Card className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:gap-10">
              <div>
                <div className="flex items-center gap-3">
                  <span className="liquid-primary grid size-11 place-items-center rounded-full">
                    <Icon name={step.icon} size={20} />
                  </span>
                  <span className="text-caption text-muted font-semibold tracking-wide uppercase">
                    Шаг {index + 1}
                  </span>
                </div>
                <h2 className="text-h3 mt-4 font-semibold">{step.title}</h2>
                <p className="text-small text-muted mt-2">{step.summary}</p>
              </div>
              <div className="grid gap-6 sm:grid-cols-3">
                <StepList title="Что происходит" items={step.activities} />
                <StepList
                  title="Что понадобится от вас"
                  items={step.fromClient}
                />
                <div>
                  <h3 className="text-caption text-muted font-semibold tracking-wide uppercase">
                    Итог шага
                  </h3>
                  <p className="text-small mt-3">{step.outcome}</p>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ol>

      <section aria-labelledby="prices-title" className="mt-20">
        <h2 id="prices-title" className="text-h2 font-semibold">
          Как читать цены в каталоге
        </h2>
        <p className="text-muted mt-3 max-w-prose">
          У каждого пакета указан вид цены. Суммы ниже — пример оформления, а не
          предложение.
        </p>
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {priceKinds.map((item) => (
            <li key={item.title}>
              <Card className="h-full">
                <PriceTag price={item.price} size="lg" />
                <h3 className="text-body mt-4 font-semibold">{item.title}</h3>
                <p className="text-small text-muted mt-1.5">{item.text}</p>
              </Card>
            </li>
          ))}
        </ul>
        <p className="text-caption text-muted mt-4">
          Цены предварительные, до окончательного согласования. Сроки
          определяются после обследования клиники.
        </p>
      </section>

      <div className="mt-20">
        <CtaPanel />
      </div>
    </Section>
  );
}

function StepList({
  title,
  items,
}: {
  title: string;
  items: readonly string[];
}) {
  return (
    <div>
      <h3 className="text-caption text-muted font-semibold tracking-wide uppercase">
        {title}
      </h3>
      <ul className="mt-3 grid gap-2">
        {items.map((item) => (
          <li key={item} className="text-small flex gap-2">
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
  );
}
