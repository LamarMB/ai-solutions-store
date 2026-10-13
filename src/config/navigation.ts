export type NavItem = {
  href: string;
  label: string;
};

/** Основные разделы — шапка, мобильное меню и подвал. */
export const mainNav = [
  { href: "/catalog", label: "Каталог" },
  { href: "/industries", label: "Отрасли" },
  { href: "/how-we-work", label: "Как мы работаем" },
  { href: "/about", label: "О компании" },
] as const satisfies readonly NavItem[];

/** Действия в шапке. */
export const headerActions = {
  consultant: { href: "/consultant", label: "Подобрать с ИИ" },
  request: { href: "/request", label: "Оставить заявку" },
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
    items: [headerActions.request, headerActions.consultant],
  },
] as const satisfies readonly { title: string; items: readonly NavItem[] }[];

/** Все адреса, на которые ссылается навигация. */
export const allNavHrefs = [
  ...mainNav.map((item) => item.href),
  ...Object.values(headerActions).map((item) => item.href),
];

/** Активен ли пункт меню для текущего адреса (включая вложенные страницы). */
export function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
