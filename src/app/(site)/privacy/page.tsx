import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Section } from "@/components/ui/Section";
import { privacyPolicy } from "@/content/privacy";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Политика конфиденциальности",
  description:
    "Политика обработки персональных данных, которые посетители сайта указывают в формах заявки.",
  path: "/privacy",
  noindex: true,
});

/**
 * Политика из src/content/privacy.ts. Пока её нет — заглушка: текст, сведения об
 * операторе и реквизиты утверждаются отдельно и сюда не выдумываются.
 */
export default function PrivacyPage() {
  if (privacyPolicy) {
    return (
      <Section className="pt-8 md:pt-12 xl:pt-14">
        <Breadcrumbs
          items={[
            { label: "Главная", href: "/" },
            { label: "Политика конфиденциальности" },
          ]}
        />
        <article className="mt-8 max-w-prose">
          <h1 className="text-h1 font-semibold">
            Политика обработки персональных данных
          </h1>
          <p className="text-muted mt-4">
            Оператор: {privacyPolicy.operator}. Контакт для запросов:{" "}
            {privacyPolicy.contact}. Редакция от {privacyPolicy.updatedAt}.
          </p>
          {privacyPolicy.sections.map((section) => (
            <section key={section.title} className="mt-8">
              <h2 className="text-h3 font-semibold">{section.title}</h2>
              <p className="text-muted mt-3 whitespace-pre-line">
                {section.text}
              </p>
            </section>
          ))}
        </article>
      </Section>
    );
  }
  return (
    <Section className="pt-8 md:pt-12 xl:pt-14">
      <Breadcrumbs
        items={[
          { label: "Главная", href: "/" },
          { label: "Политика конфиденциальности" },
        ]}
      />
      <div className="mt-8 max-w-prose">
        <h1 className="text-h1 font-semibold">Политика конфиденциальности</h1>
        <div className="rounded-card border-demo-ink/25 bg-demo-bg mt-8 border p-5 sm:p-6">
          <h2 className="text-body text-demo-ink font-semibold">
            Документ ещё не утверждён
          </h2>
          <p className="text-small text-demo-ink mt-2">
            Политика обработки персональных данных и сведения об операторе будут
            опубликованы до запуска приёма заявок. Пока документ не утверждён,
            форма заявки работает в тестовом режиме: данные не сохраняются и
            никуда не передаются.
          </p>
        </div>
        <p className="text-muted mt-6">
          <Link href="/request" className="text-accent hover:text-accent-hover">
            Вернуться к заявке
          </Link>
        </p>
      </div>
    </Section>
  );
}
