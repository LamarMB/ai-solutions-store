"use client";

import { useCallback, useEffect, useState } from "react";

/** Ошибка API: текст для администратора и ошибки по полям формы. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

/** Запрос к API панели. 401 — сессия закончилась: переход на страницу входа. */
export async function api<T = unknown>(
  path: string,
  { method = "GET", body }: { method?: string; body?: unknown } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/admin/${path}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Нет связи с сервером. Проверьте подключение.", 0);
  }
  const json = (await response.json().catch(() => null)) as {
    ok: boolean;
    data?: T;
    error?: string;
    fields?: Record<string, string>;
  } | null;
  if (response.status === 401 && path !== "login") {
    window.location.assign(new URL("/admin/login", window.location.origin));
  }
  if (!json?.ok)
    throw new ApiError(
      json?.error ?? "Не удалось выполнить действие.",
      response.status,
      json?.fields,
    );
  return json.data as T;
}

/**
 * Загрузка данных страницы с повтором по запросу. Состояние привязано к ключу
 * запроса: «идёт загрузка» — пока ответ получен для другого ключа; прежние
 * данные остаются на экране до прихода новых.
 */
export function useResource<T>(path: string | null) {
  const [version, setVersion] = useState(0);
  const key = path === null ? null : `${path}#${version}`;
  const [state, setState] = useState<{
    key: string | null;
    data?: T;
    error?: string;
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
            error: e instanceof Error ? e.message : "Ошибка загрузки",
          }));
      });
    return () => {
      cancelled = true;
    };
  }, [path, key]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const setData = useCallback(
    (update: (data: T | undefined) => T | undefined) =>
      setState((s) => ({ ...s, data: update(s.data) })),
    [],
  );
  return {
    data: state.data,
    error: state.key === key ? state.error : undefined,
    loading: key !== null && state.key !== key,
    reload,
    setData,
  };
}
