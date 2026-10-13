import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "accent" | "demo";

const tones: Record<Tone, string> = {
  neutral: "border-border bg-surface-2 text-muted",
  accent: "border-transparent bg-accent-soft text-accent",
  demo: "border-demo-ink/25 bg-demo-bg text-demo-ink",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "text-caption inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Обязательная плашка для демонстрационных данных (isDemo). */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <Badge tone="demo" className={className} title="Демонстрационные данные">
      Демо
    </Badge>
  );
}
