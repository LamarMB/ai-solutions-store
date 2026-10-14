import type { CategoryInput } from "@/catalog/schema";

export const categories = [
  {
    id: "assistants",
    title: "Ассистенты и чат-боты",
    description:
      "Диалоговые ИИ-ассистенты для общения с клиентами и сотрудниками.",
  },
  {
    id: "document-processing",
    title: "Обработка документов",
    description: "Распознавание, извлечение и проверка данных из документов.",
  },
  {
    id: "process-automation",
    title: "Автоматизация процессов",
    description:
      "Автоматизация повторяющихся операций и передачи данных между системами.",
  },
  {
    id: "analytics",
    title: "Аналитика",
    description: "Сбор, анализ и наглядное представление данных бизнеса.",
  },
  {
    id: "integrations",
    title: "Интеграции",
    description: "Подключение ИИ-функций к существующим системам заказчика.",
  },
  {
    id: "accounting",
    title: "Бухгалтерия и учёт",
    description:
      "Обработка первичных документов, сверка и контроль бухгалтерских данных.",
  },
  {
    id: "sales",
    title: "Продажи",
    description:
      "Работа с входящими обращениями, лидами и клиентской базой отдела продаж.",
  },
  {
    id: "hr",
    title: "HR и персонал",
    description: "Подбор, адаптация и ответы сотрудникам на кадровые вопросы.",
  },
  {
    id: "knowledge-search",
    title: "Поиск по базе знаний",
    description:
      "Ответы на вопросы по внутренним документам со ссылками на источник.",
  },
] satisfies CategoryInput[];
