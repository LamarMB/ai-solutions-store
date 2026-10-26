"use client";

/** Скрытое объявление для скринридера: какой шаг выбран. */
export function LiveTitle({ text }: { text: string }) {
  return (
    <p aria-live="polite" className="sr-only">
      {text}
    </p>
  );
}
