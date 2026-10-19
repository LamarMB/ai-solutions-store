"use client";

import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import type { ApiError, PatientBooking } from "@/components/miniapp/client";
import { cn } from "@/lib/cn";

/* Базовые элементы Mini App в токенах светлой темы (globals.css, .theme-miniapp). */

type Variant = "primary" | "secondary" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "liquid-primary",
  secondary: "border-border-strong bg-surface text-ink border",
  danger: "border-danger/30 bg-surface text-danger border",
};

/** Кнопка-«пилюля»; `block` — на всю ширину, `small` — компактная. */
export function Button({
  variant = "primary",
  block,
  small,
  className,
  ...props
}: ComponentProps<"button"> & {
  variant?: Variant;
  block?: boolean;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "rounded-control inline-flex items-center justify-center gap-2 font-semibold transition-[transform,filter] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
        small ? "text-small h-10 px-4" : "text-body h-12 px-6",
        block ? "w-full" : "",
        VARIANTS[variant],
        className,
      )}
    />
  );
}

export function Card({
  children,
  className,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "li" | "div" | "article";
}) {
  return (
    <Tag
      className={cn(
        "border-border bg-surface rounded-card border p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04)]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mt-6 mb-3 flex items-center justify-between gap-3">
      <h2 className="text-body font-semibold">{children}</h2>
      {action}
    </div>
  );
}

export function LinkButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-small text-accent inline-flex items-center gap-1 font-medium"
    >
      {children}
      <Icon name="chevron-right" size={16} />
    </button>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <p className="text-muted flex items-center gap-3 py-6" role="status">
      <span className="border-accent size-5 animate-spin rounded-full border-2 border-t-transparent" />
      {label}
    </p>
  );
}

/** Плейсхолдеры карточек на время загрузки. */
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="bg-surface-2 rounded-card h-20 animate-pulse" />
      ))}
    </div>
  );
}

export function EmptyState({
  icon = "calendar",
  title,
  text,
  action,
}: {
  icon?: IconName;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center gap-2 py-8 text-center">
      <span className="bg-accent-soft text-accent mb-1 flex size-12 items-center justify-center rounded-full">
        <Icon name={icon} size={24} />
      </span>
      <p className="font-semibold">{title}</p>
      {text && <p className="text-small text-muted max-w-xs">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </Card>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: ApiError | string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="border-danger/25 bg-surface text-danger rounded-card flex w-full flex-col gap-3 border p-4"
    >
      <p className="text-small">
        {typeof error === "string" ? error : error.message}
      </p>
      {onRetry && (
        <Button small variant="secondary" onClick={onRetry}>
          Повторить
        </Button>
      )}
    </div>
  );
}

const STATUS: Record<
  PatientBooking["status"] | "past",
  { label: string; className: string }
> = {
  confirmed: { label: "Подтверждена", className: "bg-accent-soft text-accent" },
  completed: { label: "Приём состоялся", className: "bg-surface-2 text-ink" },
  cancelled: { label: "Отменена", className: "bg-surface-2 text-muted" },
  past: { label: "Прошла", className: "bg-surface-2 text-muted" },
};

export function StatusBadge({ booking }: { booking: PatientBooking }) {
  const key =
    booking.status === "confirmed" && !booking.upcoming
      ? "past"
      : booking.status;
  return (
    <span
      className={cn(
        "text-caption rounded-control inline-flex px-2.5 py-0.5 font-semibold whitespace-nowrap",
        STATUS[key].className,
      )}
    >
      {STATUS[key].label}
    </span>
  );
}

/** Нижний лист подтверждения на <dialog>: фокус и Escape — средствами браузера. */
export function Sheet({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="bg-surface text-ink rounded-t-panel m-0 mt-auto w-full max-w-none p-0 backdrop:bg-black/40 sm:m-auto sm:max-w-md sm:rounded-b-[28px]"
    >
      {open && (
        <div className="miniapp-sheet p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          <h2 className="text-h3 mb-3 font-semibold">{title}</h2>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function InfoRow({
  icon,
  label,
  children,
}: {
  icon: IconName;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3 py-2.5">
      <span className="text-accent mt-0.5 shrink-0">
        <Icon name={icon} size={20} />
      </span>
      <div className="min-w-0">
        <p className="text-caption text-muted">{label}</p>
        <div className="break-words">{children}</div>
      </div>
    </div>
  );
}
