import type { Metadata } from "next";
import Link from "next/link";
import { CtaPanel } from "@/components/marketing/CtaPanel";
import { PrincipleGrid } from "@/components/marketing/PrincipleGrid";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Card } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { principles } from "@/content/approach";

export const metadata: Metadata = {
  title: "О компании",
  description:
    "Подход к внедрению ИИ и автоматизации: каталог решений с понятным составом работ, ценой и ограничениями.",
};

const siteParts = [
  {
    title: "Каталог решений",
    text: "Решения с категориями, отраслями, пакетами и ценой.",
    href: "/catalog",
    status: "Работает",
  },
  {
    title: "Страницы решений",
    text: "Состав пакетов, этапы внедрения, требования к данным и доступам, ограничения.",
    href: "/catalog",
    status: "Работает",
  },
  {
    title: "Заявка на решение",
    text: "Заявка на выбранный пакет.",
    href: "/request",
    status: "В разработке",
  },
  {
    title: "ИИ-консультант",
    text: "Помощь в подборе решения под задачу.",
    href: "/consultant",
    status: "В разработке",
  },
] as const;

export default function AboutPage() {
  return (
    <Section className="pt-8 md:pt-12 xl:pt-14">
      <Breadcrumbs
        items={[{ label: "Главная", href: "/" }, { label: "О компании" }]}
      />
      <header className="mt-8 max-w-prose">
        <h1 className="text-h1 font-semibold">О компании</h1>
        <p className="text-h3 text-muted mt-4 font-normal">
          Мы занимаемся внедрением искусственного интеллекта и автоматизации в
          процессы бизнеса разных отраслей.
        </p>
        <p className="text-muted mt-4">
          Решения собраны в каталог, как в интернет-магазине: у каждого указаны
          пакеты внедрения, состав работ, стоимость, требования к данным и
          доступам и ограничения. Так задачу и подходящее решение можно оценить
          ещё до первого разговора.
        </p>
      </header>

      <section aria-labelledby="principles-title" className="mt-16">
        <h2 id="principles-title" className="text-h2 font-semibold">
          Принципы работы
        </h2>
        <div className="mt-8">
          <PrincipleGrid items={principles} />
        </div>
      </section>

      <section aria-labelledby="site-title" className="mt-20">
        <h2 id="site-title" className="text-h2 font-semibold">
          Что есть на сайте
        </h2>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {siteParts.map((part) => (
            <li key={part.title}>
              <Card className="flex h-full flex-col">
                <span className="text-caption text-muted">{part.status}</span>
                <h3 className="text-body mt-2 font-semibold">
                  <Link
                    href={part.href}
                    className="hover:text-accent rounded-sm transition-colors"
                  >
                    {part.title}
                  </Link>
                </h3>
                <p className="text-small text-muted mt-1.5">{part.text}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <aside
        aria-labelledby="demo-title"
        className="rounded-card border-demo-ink/25 bg-demo-bg mt-12 border p-5 sm:p-6"
      >
        <h2 id="demo-title" className="text-body text-demo-ink font-semibold">
          О демо-версии
        </h2>
        <p className="text-small text-demo-ink mt-2">
          Сайт находится в разработке. Решения, цены и сроки в каталоге
          демонстрационные и не являются предложением.
        </p>
      </aside>

      <div className="mt-20">
        <CtaPanel />
      </div>
    </Section>
  );
}
