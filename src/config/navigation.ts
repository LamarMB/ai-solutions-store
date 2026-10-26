import { telegram } from "@/config/contact";

export type NavItem = {
  href: string;
  label: string;
};

/** Основные разделы — шапка, мобильное меню и подвал. */
export const mainNav = [
  { href: "/catalog", label: "Решения" },
  { href: "/#tariffs", label: "Тарифы" },
  { href: "/how-we-work", label: "Как мы работаем" },
  { href: "/about", label: "О компании" },
] as const satisfies readonly NavItem[];

/** Действия в шапке. */
export const headerActions = {
  consultant: { href: "/consultant", label: "Подобрать решение" },
  request: { href: "/request", label: "Оставить заявку" },
  /** Обращение клиента — рабочий Telegram (config/contact.ts), новая вкладка. */
  demo: { href: telegram.href, label: "Запросить демонстрацию" },
} as const satisfies Record<string, NavItem>;

/** Группы ссылок подвала. */
export const footerNav = [
  {
    title: "Каталог",
    items: [mainNav[0], mainNav[1]],
  },
  {
    title: "Компания",
    items: [mainNav[2], mainNav[3]],
  },
  {
    title: "Связаться",
    items: [
      { href: telegram.href, label: `Telegram ${telegram.handle}` },
      headerActions.consultant,
    ],
  },
] as const satisfies readonly { title: string; items: readonly NavItem[] }[];

/** Внешняя ли ссылка (открывается в новой вкладке). */
export const isExternalHref = (href: string) => /^https?:\/\//.test(href);

/** Все адреса страниц сайта, на которые ссылается навигация. */
export const allNavHrefs = [
  ...mainNav.map((item) => item.href),
  ...Object.values(headerActions).map((item) => item.href),
].filter((href) => !isExternalHref(href));

/** Активен ли пункт меню для текущего адреса (включая вложенные страницы). */
export function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
