import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/** Контейнер страницы: максимум 1280 px, поля 16 / 24 / 32 px. */
export function Container({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "max-w-page mx-auto w-full px-4 sm:px-6 lg:px-8",
        className,
      )}
      {...props}
    />
  );
}
