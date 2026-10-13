/** Ссылка «Перейти к содержимому» — видна только при фокусе с клавиатуры. */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="rounded-control bg-accent text-small text-accent-ink sr-only px-4 py-2 font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
    >
      Перейти к содержимому
    </a>
  );
}
