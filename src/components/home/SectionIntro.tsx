import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Подпись, крупный заголовок и вводный текст раздела главной. */
export function SectionIntro({
  id,
  eyebrow,
  title,
  text,
  action,
  className,
}: {
  id: string;
  eyebrow: string;
  title: ReactNode;
  text?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-reveal
      className={cn(
        "flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between",
        className,
      )}
    >
      <div className="max-w-3xl">
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={id} className="text-section mt-5 font-semibold text-balance">
          {title}
        </h2>
        {text && (
          <p className="text-lead text-muted mt-5 max-w-2xl text-pretty">
            {text}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
