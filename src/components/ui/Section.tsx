import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { Container } from "@/components/ui/Container";

/** Секция страницы с вертикальным ритмом 64 / 96 / 128 px. */
export function Section({
  className,
  children,
  ...props
}: ComponentProps<"section">) {
  return (
    <section className={cn("py-16 md:py-24 xl:py-32", className)} {...props}>
      <Container>{children}</Container>
    </section>
  );
}
