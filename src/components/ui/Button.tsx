import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg" | "icon";

const base =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50";

const variants: Record<Variant, string> = {
  /** Светлая «жидкая» пилюля — главное действие. */
  primary: "liquid-primary",
  /** Стеклянная пилюля. */
  secondary: "glass glass-hover text-ink",
  /** Без фона; при наведении — лёгкая подложка. */
  ghost: "text-ink hover:bg-surface-2",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3.5 text-small",
  md: "h-11 px-5 text-small",
  lg: "h-13 px-6 text-body",
  icon: "size-10",
};

type StyleProps = { variant?: Variant; size?: Size };

export function buttonClasses({
  variant = "primary",
  size = "md",
}: StyleProps = {}) {
  return cn(base, variants[variant], sizes[size]);
}

export function Button({
  variant,
  size,
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & StyleProps) {
  return (
    <button
      type={type}
      className={cn(buttonClasses({ variant, size }), className)}
      {...props}
    />
  );
}

export function ButtonLink({
  variant,
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & StyleProps) {
  return (
    <Link
      className={cn(buttonClasses({ variant, size }), className)}
      {...props}
    />
  );
}
