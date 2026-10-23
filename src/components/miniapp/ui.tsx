"use client";

import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import type { ApiError, PatientBooking } from "@/components/miniapp/client";
import { MaIcon, type MaIconName } from "@/components/miniapp/icons";
import { cn } from "@/lib/cn";

/*
 * Базовые элементы VK Mini App в токенах «премиальной клиники» (globals.css,
 * .theme-miniapp): белые карточки с мягкой тенью, изумрудный акцент, крупные
 * кнопки-«пилюли». Размеры и варианты — через пропсы, не через className.
 */

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "lg" | "md" | "sm";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink shadow-cta active:bg-accent-hover",
  secondary: "border-border-strong bg-surface text-ink border",
  danger: "border-danger/25 bg-surface text-danger border",
  ghost: "text-accent",
};
const SIZES: Record<Size, string> = {
  lg: "h-14 px-7 text-body",
  md: "h-12 px-6 text-body",
  sm: "h-10 px-4 text-small",
};

export function Button({
  variant = "primary",
  size = "md",
  block,
  className,
  ...props
}: ComponentProps<"button"> & {
  variant?: Variant;
  size?: Size;
  block?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "rounded-control inline-flex items-center justify-center gap-2 font-semibold transition-[transform,background-color] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45",
        SIZES[size],
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
  raised,
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "li" | "div" | "article";
  /** Выделенная карточка (ближайшая запись, выбранный врач). */
  raised?: boolean;
}) {
  return (
    <Tag
      className={cn(
        "bg-surface rounded-card",
        raised ? "shadow-raised" : "shadow-card",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** Карточка-кнопка: вся поверхность нажимается. */
export function CardButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "bg-surface rounded-card shadow-card flex w-full items-center gap-3 p-3.5 text-left transition-transform duration-150 active:scale-[0.99]",
        className,
      )}
    />
  );
}

/** Заголовок экрана: серифный, крупный. */
export function ScreenTitle({
  children,
  subtitle,
}: {
  children: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <header className="mb-5">
      <h1 className="font-display text-[1.75rem] leading-tight font-semibold">
        {children}
      </h1>
      {subtitle && <p className="text-small text-muted mt-1.5">{subtitle}</p>}
    </header>
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
    <div className="mt-8 mb-3 flex items-center justify-between gap-3">
      <h2 className="text-[1.125rem] font-semibold">{children}</h2>
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
      className="text-small text-accent -mr-1 inline-flex items-center gap-0.5 px-1 py-1 font-semibold"
    >
      {children}
      <MaIcon name="chevron" size={16} />
    </button>
  );
}

/** Фильтр-«пилюля» (специальности, категории). */
export function Chip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-control text-small h-10 shrink-0 px-4 font-medium whitespace-nowrap transition-colors",
        active
          ? "bg-accent text-accent-ink"
          : "bg-surface text-ink shadow-card",
      )}
    >
      {children}
    </button>
  );
}

/** Горизонтальная лента с прокруткой до краёв экрана. */
export function Scroller({
  children,
  label,
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <div
      role={label ? "group" : undefined}
      aria-label={label}
      className="-mx-5 flex [scrollbar-width:none] gap-2 overflow-x-auto px-5 pt-1 pb-4"
    >
      {children}
    </div>
  );
}

/** Переключатель из двух вариантов («Предстоящие» / «Прошедшие»). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (id: T) => void;
}) {
  return (
    <div
      role="tablist"
      className="bg-surface-2 rounded-control mb-5 grid p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded-control text-small h-10 font-semibold transition-colors",
            value === o.id ? "bg-accent text-accent-ink" : "text-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
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
export function Skeleton({
  rows = 3,
  height = "h-20",
}: {
  rows?: number;
  height?: "h-12" | "h-20" | "h-28";
}) {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={cn("bg-surface-2 rounded-card animate-pulse", height)}
        />
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
  icon?: MaIconName;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span className="bg-accent-soft text-accent mb-2 flex size-14 items-center justify-center rounded-full">
        <MaIcon name={icon} size={26} />
      </span>
      <p className="font-semibold">{title}</p>
      {text && <p className="text-small text-muted max-w-xs">{text}</p>}
      {action && <div className="mt-3">{action}</div>}
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
      className="bg-surface rounded-card shadow-card flex w-full flex-col gap-3 p-4"
    >
      <p className="text-small text-danger">
        {typeof error === "string" ? error : error.message}
      </p>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
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
        "text-caption rounded-control inline-flex px-2.5 py-1 font-semibold whitespace-nowrap",
        STATUS[key].className,
      )}
    >
      {STATUS[key].label}
    </span>
  );
}

/** Метка демонстрационных данных. */
export function DemoTag() {
  return (
    <span className="bg-demo-bg text-demo-ink rounded-control text-caption px-2.5 py-1 font-semibold">
      Демо
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
        <div className="miniapp-sheet p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <span
            aria-hidden
            className="bg-border-strong mx-auto -mt-2 mb-4 block h-1 w-10 rounded-full"
          />
          <h2 className="font-display mb-3 text-[1.375rem] font-semibold">
            {title}
          </h2>
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
  icon: MaIconName;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3.5 py-3">
      <span className="bg-accent-soft text-accent flex size-10 shrink-0 items-center justify-center rounded-full">
        <MaIcon name={icon} size={20} />
      </span>
      <div className="min-w-0">
        <p className="text-caption text-muted">{label}</p>
        <div className="break-words">{children}</div>
      </div>
    </div>
  );
}

/** Шапка экрана поверх вкладок: «Назад», заголовок, действие справа. */
export function TopBar({
  title,
  onBack,
  action,
  transparent,
}: {
  title?: string;
  onBack: () => void;
  action?: ReactNode;
  transparent?: boolean;
}) {
  return (
    <header
      className={cn(
        "sticky top-0 z-10 flex items-center gap-2 px-3 pt-[calc(0.5rem+env(safe-area-inset-top))] pb-2",
        transparent ? "" : "bg-bg",
      )}
    >
      <button
        type="button"
        onClick={onBack}
        aria-label="Назад"
        className="bg-surface shadow-card text-ink flex size-11 items-center justify-center rounded-full"
      >
        <MaIcon name="back" size={22} />
      </button>
      <h1 className="flex-1 truncate px-1 text-center text-[1.0625rem] font-semibold">
        {title}
      </h1>
      <span className="flex size-11 items-center justify-center">{action}</span>
    </header>
  );
}

/** Закреплённая нижняя панель с главным действием (над безопасной зоной). */
export function StickyFooter({ children }: { children: ReactNode }) {
  return (
    <div className="bg-bg fixed inset-x-0 bottom-0 z-20 px-5 pt-3 pb-[calc(0.875rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-xl">{children}</div>
    </div>
  );
}
