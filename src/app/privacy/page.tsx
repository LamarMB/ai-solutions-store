import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Section } from "@/components/ui/Section";

export const metadata: Metadata = {
  title: "Политика конфиденциальности",
  robots: { index: false, follow: true },
};

/**
 * Заглушка. Текст политики, сведения об операторе персональных данных и
 * реквизиты утверждаются отдельно и сюда не выдумываются.
 */
export default function PrivacyPage() {
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
