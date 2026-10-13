import type { ReactNode } from "react";

/** Заголовок секции: надзаголовок, заголовок, пояснение и действие справа. */
export function SectionHeading({
  id,
  eyebrow,
  title,
  text,
  action,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        {eyebrow && (
          <p className="text-caption text-accent font-semibold tracking-wide uppercase">
            {eyebrow}
          </p>
        )}
        <h2 id={id} className="text-h2 mt-2 font-semibold text-balance">
          {title}
        </h2>
        {text && <p className="text-muted mt-3">{text}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
