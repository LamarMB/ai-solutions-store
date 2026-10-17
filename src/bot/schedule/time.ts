import type { Weekday } from "@/bot/clinic/types";

/** Локальная дата «ГГГГ-ММ-ДД» и время «ЧЧ:ММ» в часовом поясе клиники. */
export function localDateTime(
  now: Date,
  timeZone: string,
): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const isDate = (value: string) =>
  DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
export const isTime = (value: string) => TIME_RE.test(value);

/** Календарная арифметика без часовых поясов: дата как полночь UTC. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekday(date: string): Weekday {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (day === 0 ? 7 : day) as Weekday;
}

export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function fromMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const WEEKDAYS = ["", "пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const MONTHS = [
  "янв",
  "фев",
  "мар",
  "апр",
  "мая",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];

/** «пн, 20 окт» — коротко для кнопок. */
export function formatDayShort(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${WEEKDAYS[weekday(date)]}, ${day} ${MONTHS[month - 1]}`;
}
