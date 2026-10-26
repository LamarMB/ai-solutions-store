import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { absoluteUrl, jsonLd } from "@/lib/seo";

export type Crumb = { label: string; href?: string };

/**
 * Разметка BreadcrumbList (Schema.org) по тем же крошкам. У последнего элемента —
 * текущей страницы — адрес не указывается, это допускается спецификацией.
 */
export function breadcrumbJsonLd(items: readonly Crumb[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.label,
      ...(item.href && index < items.length - 1
        ? { item: absoluteUrl(item.href) }
        : {}),
    })),
  };
}

/** Хлебные крошки; последний элемент — текущая страница. */
export function Breadcrumbs({ items }: { items: readonly Crumb[] }) {
  return (
    <nav aria-label="Хлебные крошки">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbJsonLd(items)) }}
      />
      <ol className="text-small text-muted flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={item.label} className="flex items-center gap-1.5">
              {item.href && !last ? (
                <Link
                  href={item.href}
                  className="hover:text-ink inline-block rounded-sm py-1 transition-colors"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? "page" : undefined}
                  className="text-ink"
                >
                  {item.label}
                </span>
              )}
              {!last && <Icon name="chevron-right" size={14} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
