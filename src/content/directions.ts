import type { IconName } from "@/components/ui/Icon";

export type Direction = {
  id: string;
  title: string;
  description: string;
  icon: IconName;
  /** Решение каталога, которое закрывает задачу. */
  solutionId: string;
};

/**
 * Задачи клиники на главной. Каждая ведёт на страницу решения из каталога;
 * статус решения (например, «концепция») показывается рядом.
 */
export const directions = [
  {
    id: "questions",
    title: "Ответы пациентам круглосуточно",
    description:
      "Вопросы об услугах, ценах, врачах и графике в сообщениях сообщества ВКонтакте — без ожидания администратора.",
    icon: "chat",
    solutionId: "clinic-ai-administrator",
  },
  {
    id: "booking",
    title: "Заявки на приём",
    description:
      "Сбор заявки в переписке. Подтверждённая запись — только при интеграции с расписанием клиники.",
    icon: "calendar",
    solutionId: "clinic-ai-administrator",
  },
  {
    id: "routing",
    title: "Обработка обращений",
    description:
      "Классификация, распределение по сотрудникам и контроль необработанных обращений.",
    icon: "layers",
    solutionId: "patient-request-routing",
  },
  {
    id: "patient-prep",
    title: "Подготовка пациента к приёму",
    description:
      "Документы, анкета и описание жалоб заранее — с согласия пациента.",
    icon: "document",
    solutionId: "patient-ai-assistant",
  },
] as const satisfies readonly Direction[];
