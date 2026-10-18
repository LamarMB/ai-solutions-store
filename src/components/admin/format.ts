/** Форматирование для панели: даты, статусы, деньги — по-русски. */

export const STATUS_LABELS = {
  confirmed: "Подтверждена",
  completed: "Завершена",
  cancelled: "Отменена",
} as const;

export const SOURCE_LABELS = {
  vk: "ВКонтакте",
  admin: "Администратор",
} as const;

export const WEEKDAYS = [
  { id: 1, short: "Пн", long: "Понедельник" },
  { id: 2, short: "Вт", long: "Вторник" },
  { id: 3, short: "Ср", long: "Среда" },
  { id: 4, short: "Чт", long: "Четверг" },
  { id: 5, short: "Пт", long: "Пятница" },
  { id: 6, short: "Сб", long: "Суббота" },
  { id: 7, short: "Вс", long: "Воскресенье" },
] as const;

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  weekday: "short",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/** «ГГГГ-ММ-ДД» → «пн, 19 октября». */
export const formatDate = (date: string) =>
  dateFormat.format(new Date(`${date}T00:00:00Z`));

/** Момент времени → «19.10, 14:05» в часовом поясе браузера. */
export const formatMoment = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

export const rub = (value: number) =>
  `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;

/** Дата «ГГГГ-ММ-ДД» со сдвигом на n дней. */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
