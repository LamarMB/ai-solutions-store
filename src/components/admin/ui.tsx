"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { STATUS_LABELS } from "@/components/admin/format";

/* Базовые элементы панели в токенах сайта (globals.css). */

export const inputClass =
  "border-border-strong bg-surface-2 text-ink placeholder:text-muted rounded-field h-11 w-full border px-3.5 text-body outline-none transition-colors focus:border-accent disabled:opacity-60 aria-[invalid=true]:border-danger";

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (props: {
    id: string;
    "aria-invalid": boolean;
    "aria-describedby"?: string;
  }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-small font-medium">
        {label}
      </label>
      {children({
        id,
        "aria-invalid": Boolean(error),
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
      })}
      {error ? (
        <p id={`${id}-error`} className="text-small text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-caption text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** `narrow` — узкое поле (время): ширина задаётся вариантом, а не className. */
export function Input({
  narrow,
  className,
  ...props
}: ComponentProps<"input"> & { narrow?: boolean }) {
  return (
    <input
      {...props}
      className={cn(
        narrow ? inputClass.replace("w-full", "w-36") : inputClass,
        className,
      )}
    />
  );
}

export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={cn(inputClass, props.className)} />;
}

export function Textarea(props: ComponentProps<"textarea">) {
  return (
    <textarea
      {...props}
      className={cn(inputClass, "h-auto min-h-24 py-2.5", props.className)}
    />
  );
}

export function DangerButton({
  className,
  small,
  ...props
}: ComponentProps<"button"> & { small?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "border-danger/40 text-danger hover:bg-danger/10 rounded-control text-small inline-flex items-center justify-center gap-2 border font-medium transition-colors disabled:opacity-50",
        small ? "h-9 px-3.5" : "h-11 px-5",
        className,
      )}
    />
  );
}

/** Плотная поверхность раздела. */
export function Panel({
  title,
  actions,
  children,
  className,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "border-border bg-surface rounded-card border p-4 sm:p-5",
        className,
      )}
    >
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="text-h3 font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-h2 font-semibold">{title}</h1>
        {description && <p className="text-muted mt-1">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-border rounded-card flex flex-col items-center gap-2 border border-dashed px-4 py-10 text-center">
      <p className="font-medium">{title}</p>
      {text && <p className="text-small text-muted max-w-md">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Loading({ label = "Загрузка…" }: { label?: string }) {
  return (
    <p className="text-muted flex items-center gap-2 py-6" role="status">
      <span className="border-muted size-4 animate-spin rounded-full border-2 border-t-transparent" />
      {label}
    </p>
  );
}

export function ErrorNote({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="border-danger/40 bg-danger/10 text-danger rounded-field text-small flex flex-wrap items-center justify-between gap-3 border px-4 py-3"
    >
      <span>{message}</span>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Повторить
        </Button>
      )}
    </div>
  );
}

const STATUS_STYLES = {
  confirmed: "bg-accent-soft text-accent",
  completed: "bg-success/15 text-success",
  cancelled: "bg-surface-2 text-muted",
} as const;

export function StatusBadge({
  status,
}: {
  status: keyof typeof STATUS_LABELS;
}) {
  return (
    <span
      className={cn(
        "rounded-control text-caption inline-flex items-center px-2.5 py-0.5 font-medium whitespace-nowrap",
        STATUS_STYLES[status],
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

/** Модальное окно на <dialog>: фокус, Escape и затемнение — средствами браузера. */
export function Modal({
  open,
  title,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
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
      // Закрытие пользователем — только Escape (cancel) и кнопки. Событие close
      // приходит и при программном закрытии, поэтому оно не вызывает onClose.
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={cn(
        "border-border-strong bg-surface text-ink rounded-panel m-auto w-[calc(100%-2rem)] border p-0 backdrop:bg-black/70",
        wide ? "max-w-3xl" : "max-w-lg",
      )}
    >
      {open && (
        <div className="max-h-[85dvh] overflow-y-auto p-5 sm:p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <h2 className="text-h3 font-semibold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть"
              className="text-muted hover:text-ink -m-1 rounded-full p-1 text-xl leading-none"
            >
              ×
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

/** Подтверждение опасного действия. */
export function ConfirmDialog({
  open,
  title,
  text,
  confirmLabel,
  onConfirm,
  onClose,
  busy,
}: {
  open: boolean;
  title: string;
  text: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
}) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <div className="text-muted">{text}</div>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Не надо
        </Button>
        <DangerButton onClick={onConfirm} disabled={busy}>
          {busy ? "Выполняю…" : confirmLabel}
        </DangerButton>
      </div>
    </Modal>
  );
}

/* Уведомления о результате действий. */

type Toast = { id: number; text: string; kind: "ok" | "error" };
const ToastContext = createContext<
  (text: string, kind?: Toast["kind"]) => void
>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((text: string, kind: Toast["kind"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, text, kind }]);
    setTimeout(
      () => setToasts((list) => list.filter((t) => t.id !== id)),
      kind === "error" ? 7000 : 3500,
    );
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-center gap-2 sm:right-6 sm:left-auto sm:items-end"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={cn(
              "glass rounded-field text-small pointer-events-auto max-w-sm px-4 py-3",
              t.kind === "error" ? "text-danger" : "text-ink",
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
