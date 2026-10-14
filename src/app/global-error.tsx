"use client";

import { onest } from "@/app/fonts";
import "./globals.css";

/**
 * Ошибка в корневом layout: заменяет весь документ, поэтому подключает стили и
 * шрифт сама и не использует шапку и подвал.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="ru" className={onest.variable}>
      <body className="flex min-h-dvh items-center">
        <title>Ошибка · AI Solutions Store</title>
        <main className="mx-auto w-full max-w-prose px-4 py-16" role="alert">
          <p className="text-small text-muted font-medium">Ошибка</p>
          <h1 className="text-h1 mt-3 font-semibold">Что-то пошло не так</h1>
          <p className="text-muted mt-4">
            Сайт временно не может показать страницу. Попробуйте ещё раз через
            несколько минут.
          </p>
          {error.digest && (
            <p className="text-caption text-muted mt-3">
              Код ошибки: {error.digest}
            </p>
          )}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => retry()}
              className="liquid-primary rounded-control text-small inline-flex h-11 items-center justify-center px-5 font-semibold"
            >
              Попробовать ещё раз
            </button>
            {/* Обычная ссылка: при сбое корневого layout клиентская навигация ненадёжна. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              className="glass glass-hover rounded-control text-small inline-flex h-11 items-center justify-center px-5 font-medium"
            >
              На главную
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
