import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { getSolutions } from "@/catalog";
import {
  REQUEST_PARAMS,
  resolveRequestSelection,
  solutionHref,
} from "@/catalog/links";
import { RequestForm } from "@/components/request/RequestForm";
import { DemoBadge, MaturityBadge } from "@/components/ui/Badge";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { PackagePrice } from "@/components/ui/PackagePrice";
import { Section } from "@/components/ui/Section";
import { getRequestStore } from "@/requests/store";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Оставить заявку",
  description:
    "Заявка на внедрение ИИ-решения из каталога или общая заявка. Приём заявок работает в тестовом режиме.",
  path: "/request",
  noindex: true,
});

/** Метка начала заполнения и ключ отправки — новые при каждом показе формы. */
function newFormSession() {
  return { startedAt: Date.now(), submissionId: randomUUID() };
}

export default async function RequestPage({
  searchParams,
}: PageProps<"/request">) {
  const params = await searchParams;
  const selection = resolveRequestSelection(params, getSolutions());
  const requestedSolution = params[REQUEST_PARAMS.solution];
  const unknownSelection = Boolean(requestedSolution) && !selection;
  const mode = getRequestStore().mode;
  const session = newFormSession();

  return (
    <Section className="pt-8 md:pt-12 xl:pt-14">
      <Breadcrumbs
        items={[{ label: "Главная", href: "/" }, { label: "Заявка" }]}
      />
      <header className="mt-8 max-w-prose">
        <h1 className="text-h1 font-semibold">Заявка на внедрение</h1>
        <p className="text-muted mt-4">
          Опишите задачу — по заявке уточняются детали, состав работ и
          стоимость. Решение можно выбрать в каталоге или отправить общую
          заявку.
        </p>
      </header>

      {mode === "test" && (
        <aside
          aria-labelledby="test-mode-title"
          className="rounded-card border-demo-ink/25 bg-demo-bg mt-8 border p-5 sm:p-6"
        >
          <h2
            id="test-mode-title"
            className="text-body text-demo-ink flex items-center gap-2 font-semibold"
          >
            <Icon name="shield" size={18} />
            Приём заявок ещё не запущен
          </h2>
          <p className="text-small text-demo-ink mt-2">
            Форма работает в тестовом режиме: данные проверяются, но не
            сохраняются и никуда не передаются. Пожалуйста, не указывайте
            реальные персональные данные.
          </p>
        </aside>
      )}

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12">
        <div className="order-2 lg:order-1">
          <RequestForm
            mode={mode}
            solutionId={selection?.solution.id}
            packageId={selection?.package?.id}
            startedAt={session.startedAt}
            initialSubmissionId={session.submissionId}
          />
        </div>

        <aside aria-label="Выбранное решение" className="order-1 lg:order-2">
          <Card>
            <p className="text-caption text-muted font-semibold tracking-wide uppercase">
              {selection ? "Ваш выбор" : "Общая заявка"}
            </p>
            {selection ? (
              <>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selection.solution.isDemo && <DemoBadge />}
                  <MaturityBadge maturity={selection.solution.maturity} />
                </div>
                <p className="text-h3 mt-3 font-semibold">
                  <Link
                    href={solutionHref(selection.solution.id)}
                    className="hover:text-accent rounded-sm transition-colors"
                  >
                    {selection.solution.title}
                  </Link>
                </p>
                {selection.package ? (
                  <div className="border-border mt-4 border-t pt-4">
                    <p className="text-small">
                      Пакет «{selection.package.title}»
                    </p>
                    <PackagePrice
                      pkg={selection.package}
                      size="lg"
                      className="mt-1"
                    />
                    {selection.solution.pricingNote && (
                      <p className="text-caption text-muted mt-2">
                        {selection.solution.pricingNote}
                      </p>
                    )}
                  </div>
                ) : selection.solution.packages.length === 0 ? (
                  <p className="text-small text-muted mt-3">
                    Пакеты не сформированы — стоимость по запросу.
                  </p>
                ) : (
                  <p className="text-small text-muted mt-3">Пакет не выбран</p>
                )}
                <div className="mt-5 grid gap-2">
                  <Link
                    href={solutionHref(selection.solution.id)}
                    className="text-small text-accent hover:text-accent-hover rounded-sm font-medium"
                  >
                    {selection.solution.packages.length === 0
                      ? "Вернуться к решению"
                      : "Выбрать другой пакет"}
                  </Link>
                  <Link
                    href="/request"
                    className="text-small text-muted hover:text-ink rounded-sm"
                  >
                    Отправить общую заявку без решения
                  </Link>
                </div>
              </>
            ) : (
              <>
                <p className="text-small text-muted mt-3">
                  {unknownSelection
                    ? "Указанное решение не найдено в каталоге, поэтому заявка будет общей."
                    : "Решение не выбрано. Опишите задачу — подходящее решение подберём вместе."}
                </p>
                <Link
                  href="/catalog"
                  className="text-small text-accent hover:text-accent-hover mt-4 inline-flex items-center gap-1.5 rounded-sm font-medium"
                >
                  Выбрать решение в каталоге
                  <Icon name="arrow-right" size={16} />
                </Link>
              </>
            )}
          </Card>
        </aside>
      </div>
    </Section>
  );
}
