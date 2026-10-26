import { telegram } from "@/config/contact";

/**
 * Контакт для записи на демонстрацию — рабочий Telegram (config/contact.ts).
 * Тестовая форма /request сюда не подключается. Если задать null, кнопка в
 * разделе #demo станет неактивной с пояснением.
 */
export const demoContact: { href: string; label: string } | null = {
  href: telegram.href,
  label: telegram.label,
};
