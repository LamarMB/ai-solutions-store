import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCategories, getSolutions, getStartingPrice } from "@/catalog";
import { Badge, DemoBadge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/ui/Icon";
import { PriceTag } from "@/components/ui/PriceTag";
import { Section } from "@/components/ui/Section";

export const metadata: Metadata = {
  title: "UI-компоненты",
  robots: { index: false, follow: false },
};

const colors = [
  "bg",
  "surface",
  "surface-2",
  "border",
  "border-strong",
  "ink",
  "muted",
  "accent",
  "accent-soft",
  "demo-bg",
  "demo-ink",
  "success",
  "warning",
  "danger",
];

const icons: IconName[] = [
  "menu",
  "close",
  "arrow-right",
  "chevron-right",
  "check",
  "search",
  "sparkle",
  "chat",
];

/** Служебная витрина дизайн-системы. В production-сборке недоступна. */
export default function UiPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const solutions = getSolutions();
  const categoryTitle = new Map(getCategories().map((c) => [c.id, c.title]));

  return (
    <Section>
      <h1 className="text-h1 font-semibold">UI-компоненты</h1>
      <p className="text-muted mt-3">
        Служебная страница для проверки дизайн-системы. Тема — тёмная, Liquid
        Glass.
      </p>

      <h2 className="text-h2 mt-14 font-semibold">Цвета</h2>
      <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {colors.map((name) => (
          <li key={name} className="text-caption text-muted">
            <span
              className="rounded-card border-border mb-2 block h-14 border"
              style={{ background: `var(--${name})` }}
            />
            {name}
          </li>
        ))}
      </ul>

      <h2 className="text-h2 mt-14 font-semibold">Типографика</h2>
      <div className="mt-6 grid gap-4">
        <p className="text-display font-semibold">Display 64</p>
        <p className="text-h1 font-semibold">Заголовок H1</p>
        <p className="text-h2 font-semibold">Заголовок H2</p>
        <p className="text-h3 font-semibold">Заголовок H3</p>
        <p className="max-w-prose">
          Основной текст 16/1.6. Карточки решений описывают состав работ, этапы
          внедрения, требования к данным и ограничения.
        </p>
        <p className="text-small text-muted">Мелкий текст 14</p>
        <p className="text-caption text-muted">Подпись 12</p>
      </div>

      <h2 className="text-h2 mt-14 font-semibold">Кнопки</h2>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button>Основная</Button>
        <Button variant="secondary">Вторичная</Button>
        <Button variant="ghost">Тихая</Button>
        <Button disabled>Недоступна</Button>
        <ButtonLink href="/catalog" size="lg">
          Ссылка-кнопка
          <Icon name="arrow-right" size={18} />
        </ButtonLink>
        <Button size="sm" variant="secondary">
          Маленькая
        </Button>
      </div>

      <h2 className="text-h2 mt-14 font-semibold">Метки и иконки</h2>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <DemoBadge />
        <Badge>Нейтральная</Badge>
        <Badge tone="accent">Акцентная</Badge>
        {icons.map((name) => (
          <span
            key={name}
            title={name}
            className="rounded-control border-border bg-surface grid size-10 place-items-center border"
          >
            <Icon name={name} />
          </span>
        ))}
      </div>

      <h2 className="text-h2 mt-14 font-semibold">Цены</h2>
      <div className="mt-6 flex flex-wrap items-baseline gap-8">
        <PriceTag
          price={{ kind: "fixed", amount: 15000000, currency: "RUB" }}
        />
        <PriceTag price={{ kind: "from", amount: 5000000, currency: "RUB" }} />
        <PriceTag price={{ kind: "on_request" }} />
        <PriceTag
          size="lg"
          price={{ kind: "from", amount: 25000000, currency: "RUB" }}
        />
      </div>

      <h2 className="text-h2 mt-14 font-semibold">Карточки</h2>
      <p className="text-small text-muted mt-2">
        Пример композиции из базовых компонентов на демо-данных каталога.
        Полноценная карточка решения — этап 4.
      </p>
      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {solutions.map((solution) => (
          <Card key={solution.id} interactive className="flex flex-col">
            <div className="flex flex-wrap gap-2">
              {solution.isDemo && <DemoBadge />}
              {solution.categoryIds.map((id) => (
                <Badge key={id}>{categoryTitle.get(id)}</Badge>
              ))}
            </div>
            <h3 className="text-h3 mt-4 font-semibold">{solution.title}</h3>
            <p className="text-small text-muted mt-2 flex-1">
              {solution.summary}
            </p>
            <div className="border-border mt-6 flex items-center justify-between gap-4 border-t pt-4">
              <PriceTag price={getStartingPrice(solution)} />
              <Icon name="arrow-right" className="text-muted" />
            </div>
          </Card>
        ))}
      </div>
    </Section>
  );
}
