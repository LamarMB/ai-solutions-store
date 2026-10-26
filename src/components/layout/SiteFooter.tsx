import Link from "next/link";
import { Logo } from "@/components/layout/Logo";
import { Container } from "@/components/ui/Container";
import { footerNav } from "@/config/navigation";
import { site } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="border-border bg-surface mt-auto border-t">
      <Container className="grid gap-10 py-12 md:py-16 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Logo />
          <p className="text-small text-muted mt-4 max-w-sm">
            {site.description}
          </p>
        </div>

        <nav
          aria-label="Подвал"
          className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:col-span-7"
        >
          {footerNav.map((group) => (
            <div key={group.title}>
              <h2 className="text-caption text-muted font-semibold tracking-wide uppercase">
                {group.title}
              </h2>
              <ul className="mt-2 grid">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="text-small text-ink hover:text-accent inline-block rounded-sm py-1.5 transition-colors"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </Container>

      <div className="border-border border-t">
        <Container className="text-caption text-muted flex flex-col gap-1 py-5 sm:flex-row sm:justify-between">
          <p>
            © {new Date().getFullYear()} {site.name} ·{" "}
            <Link
              href="/privacy"
              className="hover:text-ink inline-block rounded-sm py-1"
            >
              Политика конфиденциальности
            </Link>
          </p>
          <p>Демо-версия: решения, цены и описания демонстрационные.</p>
        </Container>
      </div>
    </footer>
  );
}
