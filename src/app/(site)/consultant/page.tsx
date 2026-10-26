import type { Metadata } from "next";
import { ConsultantChat } from "@/components/consultant/ConsultantChat";
import { ButtonLink } from "@/components/ui/Button";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Icon } from "@/components/ui/Icon";
import { externalLinkProps } from "@/config/contact";
import { headerActions } from "@/config/navigation";
import { Section } from "@/components/ui/Section";
import { EXAMPLE_TASKS } from "@/consultant/mock-provider";
import { getChatProvider } from "@/consultant/provider";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Подбор ИИ-решения под задачу",
  description:
    "Опишите задачу клиники — демонстрационный помощник подберёт подходящие решения из каталога. Не даёт медицинских советов, переписка не сохраняется.",
  path: "/consultant",
});

export default function ConsultantPage() {
  const provider = getChatProvider().info;

  return (
    <Section className="pt-8 md:pt-12 xl:pt-14">
      <Breadcrumbs
        items={[{ label: "Главная", href: "/" }, { label: "Подбор решения" }]}
      />
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-10">
        <div className="min-w-0">
          <header className="max-w-prose">
            <h1 className="text-h1 font-semibold">Подбор решения</h1>
            <p className="text-muted mt-3">
              Опишите задачу клиники своими словами — консультант задаст
              уточняющие вопросы и предложит подходящие решения из каталога.
              Медицинских советов он не даёт.
            </p>
          </header>

          {provider.kind === "mock" && (
            <aside
              aria-labelledby="mock-title"
              className="rounded-card border-demo-ink/25 bg-demo-bg mt-6 border p-4 sm:p-5"
            >
              <h2
                id="mock-title"
                className="text-small text-demo-ink flex items-center gap-2 font-semibold"
              >
                <Icon name="shield" size={16} />
                {provider.label}, а не ИИ
              </h2>
              <p className="text-small text-demo-ink mt-1.5">
                Подбирает решения по ключевым словам на основе каталога.
                Переписка не сохраняется и никуда не передаётся. Не указывайте
                персональные данные.
              </p>
            </aside>
          )}

          <div className="mt-6">
            <ConsultantChat examples={EXAMPLE_TASKS} />
          </div>
        </div>

        <aside aria-label="Другие способы" className="grid content-start gap-4">
          <div className="rounded-card border-border bg-surface border p-5">
            <h2 className="text-body font-semibold">Знаете, что нужно?</h2>
            <p className="text-small text-muted mt-1.5">
              Все решения для клиник с тарифами и ограничениями.
            </p>
            <ButtonLink
              href="/catalog"
              variant="secondary"
              size="sm"
              className="mt-4"
            >
              Открыть каталог
            </ButtonLink>
          </div>
          <div className="rounded-card border-border bg-surface border p-5">
            <h2 className="text-body font-semibold">Нестандартная задача?</h2>
            <p className="text-small text-muted mt-1.5">
              Напишите нам в Telegram — подходящее решение подберём вместе.
            </p>
            <ButtonLink
              href={headerActions.demo.href}
              {...externalLinkProps}
              variant="secondary"
              size="sm"
              className="mt-4"
            >
              {headerActions.demo.label}
            </ButtonLink>
          </div>
        </aside>
      </div>
    </Section>
  );
}
