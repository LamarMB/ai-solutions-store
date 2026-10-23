"use client";

import { useCallback, useEffect, useState } from "react";
import type { MiniAppService, PatientBooking } from "@/miniapp/service";

export type ClinicInfo = ReturnType<MiniAppService["clinicInfo"]>;
export type Doctor = ClinicInfo["doctors"][number];
export type MyBookings = ReturnType<MiniAppService["myBookings"]>;
export type { PatientBooking };

/** Ошибка API с кодом: unauthorized, expired, not_allowed, taken и т. д. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

/**
 * Строка параметров запуска, с которой ВКонтакте открыл приложение. Читается
 * один раз при загрузке: дальнейшая навигация не меняет адрес.
 */
let launch: string | undefined;
export function launchParams(): string {
  launch ??= window.location.search.slice(1);
  return launch;
}

/** Похоже ли, что приложение открыто ВКонтакте (окончательно решает сервер). */
export function looksLikeVkLaunch(): boolean {
  const params = new URLSearchParams(launchParams());
  return params.has("sign") && params.has("vk_user_id");
}

export async function api<T>(
  path: string,
  { method = "GET", body }: { method?: string; body?: unknown } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/miniapp/${path}`, {
      method,
      headers: {
        "X-VK-Launch-Params": launchParams(),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      credentials: "omit",
    });
  } catch {
    throw new ApiError(
      "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.",
      0,
      "network",
    );
  }
  const json = (await response.json().catch(() => null)) as {
    ok: boolean;
    data?: T;
    error?: string;
    code?: string;
  } | null;
  if (!json?.ok)
    throw new ApiError(
      json?.error ?? "Не удалось выполнить действие.",
      response.status,
      json?.code ?? "server",
    );
  return json.data as T;
}

/** Загрузка данных с повтором; прежние данные остаются до прихода новых. */
export function useApi<T>(path: string | null) {
  const [version, setVersion] = useState(0);
  const key = path === null ? null : `${path}#${version}`;
  const [state, setState] = useState<{
    key: string | null;
    data?: T;
    error?: ApiError;
  }>({ key: null });

  useEffect(() => {
    if (path === null || key === null) return;
    let cancelled = false;
    api<T>(path)
      .then((data) => {
        if (!cancelled) setState({ key, data });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setState((s) => ({
            key,
            data: s.data,
            error:
              e instanceof ApiError
                ? e
                : new ApiError("Ошибка загрузки", 0, "server"),
          }));
      });
    return () => {
      cancelled = true;
    };
  }, [path, key]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return {
    data: state.data,
    error: state.key === key ? state.error : undefined,
    loading: key !== null && state.key !== key,
    reload,
  };
}

/* Форматирование */

const dayFormat = new Intl.DateTimeFormat("ru-RU", {
  weekday: "short",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
const dayParts = new Intl.DateTimeFormat("ru-RU", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** «ГГГГ-ММ-ДД» → «пн, 19 октября». */
export const formatDay = (date: string) =>
  dayFormat.format(new Date(`${date}T00:00:00Z`));

/** Для кнопок выбора дня: «пн», «19», «окт.». */
export function dayChip(date: string) {
  const parts = dayParts.formatToParts(new Date(`${date}T00:00:00Z`));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { weekday: get("weekday"), day: get("day"), month: get("month") };
}

export const rub = (value: number) =>
  `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;

export function relativeDay(date: string, today: string): string {
  const diff = Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86_400_000,
  );
  if (diff === 0) return "сегодня";
  if (diff === 1) return "завтра";
  return formatDay(date);
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Подпись дня для выбора: «Сегодня», «Завтра» или «Пн». */
export function dayName(date: string, today: string): string {
  const diff = Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86_400_000,
  );
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Завтра";
  return capitalize(dayChip(date).weekday.replace(".", ""));
}

const longFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/** «Завтра, 13 ноября» / «Пятница, 23 октября». */
export function longDay(date: string, today: string): string {
  const name = dayName(date, today);
  const full =
    name === "Сегодня" || name === "Завтра"
      ? name
      : capitalize(
          new Intl.DateTimeFormat("ru-RU", {
            weekday: "long",
            timeZone: "UTC",
          }).format(new Date(`${date}T00:00:00Z`)),
        );
  return `${full}, ${longFormat.format(new Date(`${date}T00:00:00Z`))}`;
}
