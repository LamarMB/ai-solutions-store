/**
 * Рабочий контакт для потенциальных клиентов. Все кнопки обращения на сайте
 * («Запросить демонстрацию», «Написать в Telegram», контакт в подвале) ведут
 * сюда. Форма /request данные в Telegram не передаёт — она в тестовом режиме.
 */
export const telegram = {
  href: "https://t.me/tgboostman",
  handle: "@tgboostman",
  label: "Написать в Telegram",
} as const;

/** Внешняя ссылка: новая вкладка, без доступа к window.opener и referrer. */
export const externalLinkProps = {
  target: "_blank",
  rel: "noopener noreferrer",
} as const;
