"use client";

import { Icon } from "@/components/ui/Icon";

/** «Показать за минуту» / «Остановить показ» и полоска времени шага. */
export function AutoplayButton({
  playing,
  onStart,
  onStop,
  stepKey,
  stepMs,
}: {
  playing: boolean;
  onStart: () => void;
  onStop: () => void;
  stepKey: number;
  stepMs: number;
}) {
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <button
        type="button"
        onClick={playing ? onStop : onStart}
        aria-pressed={playing}
        className="liquid-primary rounded-control text-small inline-flex h-11 items-center gap-2 px-5 font-medium"
      >
        <Icon name={playing ? "close" : "sparkle"} size={16} />
        {playing ? "Остановить показ" : "Показать за минуту"}
      </button>
      <span
        aria-hidden="true"
        className="bg-border relative block h-0.5 w-full overflow-hidden rounded-full sm:w-44"
      >
        {playing && (
          <span
            key={stepKey}
            className="pm-progress bg-accent absolute inset-y-0 left-0 block w-full"
            style={{ animationDuration: `${stepMs}ms` }}
          />
        )}
      </span>
    </div>
  );
}

/** Скрытое объявление для скринридера: какой шаг выбран. */
export function LiveTitle({ text }: { text: string }) {
  return (
    <p aria-live="polite" className="sr-only">
      {text}
    </p>
  );
}
