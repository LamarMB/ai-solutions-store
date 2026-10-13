import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type CardProps = ComponentProps<"div"> & {
  /** Реакция на наведение — для кликабельных карточек. */
  interactive?: boolean;
};

/** Поверхность с рамкой; основа будущих карточек решений. */
export function Card({ interactive, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-card border-border bg-surface border p-5 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] sm:p-6",
        interactive &&
          "hover:border-border-strong transition-[border-color,transform] duration-200 hover:-translate-y-0.5",
        className,
      )}
      {...props}
    />
  );
}
