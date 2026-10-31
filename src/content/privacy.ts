/**
 * Политика обработки персональных данных для страницы /privacy.
 *
 * null — политика не утверждена: страница показывает заглушку, а форма заявки на
 * сайте работает в тестовом режиме (src/requests/store.ts). Текст, сведения об
 * операторе и контакты предоставляет владелец после проверки юристом — сюда их не
 * выдумывать (docs/rules/site.md).
 */
export type PrivacyPolicy = {
  /** Оператор: ФИО индивидуального предпринимателя или название организации, ИНН/ОГРН. */
  operator: string;
  /** Контакт оператора для запросов о персональных данных. */
  contact: string;
  /** Дата редакции, «ГГГГ-ММ-ДД». */
  updatedAt: string;
  sections: readonly { title: string; text: string }[];
};

export const privacyPolicy: PrivacyPolicy | null = null;
