"use client";

import Link from "next/link";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { submitRequest } from "@/app/request/actions";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import {
  fieldErrors as toFieldErrors,
  formDataToInput,
  LIMITS,
  RequestFormSchema,
  SERVICE_FIELDS,
  type ContactMethod,
  type RequestField,
} from "@/requests/schema";
import { INITIAL_STATE } from "@/requests/state";
import type { IntakeMode } from "@/requests/store";

type RequestFormProps = {
  mode: IntakeMode;
  solutionId?: string;
  packageId?: string;
  /** Время показа формы (сервер) — для защиты от ботов. */
  startedAt: number;
  /** Ключ отправки — защищает от повторной отправки. */
  initialSubmissionId: string;
};

const FIELD_ORDER: RequestField[] = [
  "name",
  "company",
  "contactMethod",
  "contact",
  "message",
  "consent",
];

export function RequestForm({
  mode,
  solutionId,
  packageId,
  startedAt,
  initialSubmissionId,
}: RequestFormProps) {
  const [state, formAction, pending] = useActionState(
    submitRequest,
    INITIAL_STATE,
  );
  const [clientErrors, setClientErrors] = useState<
    Partial<Record<RequestField, string>>
  >({});
  const [method, setMethod] = useState<ContactMethod>("email");
  const formRef = useRef<HTMLFormElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  const serverErrors = state.status === "invalid" ? state.fieldErrors : {};
  const errors = { ...serverErrors, ...clientErrors };

  // После ответа сервера переносим фокус на сообщение о результате.
  useEffect(() => {
    if (state.status !== "idle") statusRef.current?.focus();
  }, [state]);

  // С JavaScript отправляем вручную: так React не сбрасывает поля формы
  // после ответа сервера и введённое не теряется при ошибке.
  // Без JavaScript работает обычный action формы.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const formData = new FormData(event.currentTarget);
    const parsed = RequestFormSchema.safeParse(formDataToInput(formData));
    if (!parsed.success) {
      const next = toFieldErrors(parsed.error);
      setClientErrors(next);
      const first = FIELD_ORDER.find((f) => next[f]);
      if (first) {
        formRef.current
          ?.querySelector<HTMLElement>(`[data-field="${first}"]`)
          ?.focus();
      }
      return;
    }
    setClientErrors({});
    startTransition(() => formAction(formData));
  };

  const clearError = (field: RequestField) => {
    if (clientErrors[field]) {
      setClientErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  if (state.status === "accepted") {
    return (
      <div
        ref={statusRef}
        tabIndex={-1}
        role="status"
        className="rounded-card border-demo-ink/25 bg-demo-bg border p-6 outline-none sm:p-8"
      >
        <div className="text-demo-ink flex items-center gap-3">
          <span className="border-demo-ink/40 grid size-10 place-items-center rounded-full border">
            <Icon name="check" size={20} />
          </span>
          <h2 className="text-h3 font-semibold">
            {mode === "test"
              ? "Проверка пройдена — заявка не отправлена"
              : "Заявка принята"}
          </h2>
        </div>
        {mode === "test" && (
          <p className="text-small text-demo-ink mt-4">
            Приём заявок ещё не запущен: форма работает в тестовом режиме.
            Данные проверены, но не сохранены и никуда не переданы. Номер
            проверки: <span className="font-mono">{state.reference}</span>.
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="glass glass-hover text-small rounded-control text-ink h-10 px-4 font-medium"
          >
            Заполнить заново
          </button>
          <Link
            href="/catalog"
            className="liquid-primary text-small rounded-control inline-flex h-10 items-center px-4 font-medium"
          >
            Вернуться в каталог
          </Link>
        </div>
      </div>
    );
  }

  const serverMessage =
    state.status === "idle" ? null : "message" in state ? state.message : null;

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={onSubmit}
      noValidate
      aria-describedby="request-form-status"
      className="grid gap-6"
    >
      <input type="hidden" name={SERVICE_FIELDS.startedAt} value={startedAt} />
      <input
        type="hidden"
        name={SERVICE_FIELDS.submissionId}
        value={initialSubmissionId}
      />
      {solutionId && (
        <input type="hidden" name="solutionId" value={solutionId} />
      )}
      {packageId && <input type="hidden" name="packageId" value={packageId} />}

      {/* Ловушка для ботов: людям не видна и недоступна с клавиатуры. */}
      <div
        aria-hidden="true"
        className="absolute -left-[9999px] h-px w-px overflow-hidden"
      >
        <label>
          Сайт
          <input
            type="text"
            name={SERVICE_FIELDS.honeypot}
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
          />
        </label>
      </div>

      <div
        id="request-form-status"
        ref={statusRef}
        tabIndex={-1}
        role={serverMessage ? "alert" : undefined}
        className="outline-none"
      >
        {serverMessage && (
          <p className="rounded-card border-danger/40 text-danger text-small bg-danger/10 border p-4">
            {serverMessage}
          </p>
        )}
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field id="name" label="Имя" required error={errors.name}>
          <input
            id="name"
            name="name"
            data-field="name"
            autoComplete="name"
            maxLength={LIMITS.nameMax}
            required
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "name-error" : undefined}
            onInput={() => clearError("name")}
            className={inputClass(errors.name)}
          />
        </Field>
        <Field
          id="company"
          label="Компания"
          hint="необязательно"
          error={errors.company}
        >
          <input
            id="company"
            name="company"
            data-field="company"
            autoComplete="organization"
            maxLength={LIMITS.companyMax}
            aria-invalid={errors.company ? true : undefined}
            aria-describedby={errors.company ? "company-error" : undefined}
            className={inputClass(errors.company)}
          />
        </Field>
      </div>

      <fieldset>
        <legend className="text-small font-medium">
          Как с вами связаться <span className="text-muted">*</span>
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {(
            [
              ["email", "Email"],
              ["phone", "Телефон"],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={cn(
                "text-small has-focus-visible:outline-accent inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border px-4 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2",
                method === value
                  ? "border-accent/60 bg-accent-soft text-ink"
                  : "glass glass-hover text-muted",
              )}
            >
              <input
                type="radio"
                name="contactMethod"
                value={value}
                data-field={value === "email" ? "contactMethod" : undefined}
                checked={method === value}
                onChange={() => {
                  setMethod(value);
                  clearError("contact");
                }}
                className="sr-only"
              />
              {method === value && <Icon name="check" size={16} />}
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <Field
        id="contact"
        label={method === "email" ? "Email" : "Телефон"}
        required
        error={errors.contact}
      >
        <input
          id="contact"
          name="contact"
          data-field="contact"
          type={method === "email" ? "email" : "tel"}
          inputMode={method === "email" ? "email" : "tel"}
          autoComplete={method === "email" ? "email" : "tel"}
          placeholder={
            method === "email" ? "name@company.ru" : "+7 900 000-00-00"
          }
          maxLength={LIMITS.contactMax}
          required
          aria-invalid={errors.contact ? true : undefined}
          aria-describedby={errors.contact ? "contact-error" : undefined}
          onInput={() => clearError("contact")}
          className={inputClass(errors.contact)}
        />
      </Field>

      <Field
        id="message"
        label="Кратко опишите задачу"
        required
        hint={`${LIMITS.messageMin}–${LIMITS.messageMax} символов`}
        error={errors.message}
      >
        <textarea
          id="message"
          name="message"
          data-field="message"
          rows={5}
          maxLength={LIMITS.messageMax}
          required
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={errors.message ? "message-error" : "message-hint"}
          onInput={() => clearError("message")}
          className={cn(inputClass(errors.message), "h-auto resize-y py-3")}
        />
      </Field>

      <div>
        <label className="text-small flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name="consent"
            data-field="consent"
            required
            aria-invalid={errors.consent ? true : undefined}
            aria-describedby={errors.consent ? "consent-error" : undefined}
            onChange={() => clearError("consent")}
            className="accent-accent mt-0.5 size-5 shrink-0 scroll-mt-32"
          />
          <span>
            Я даю согласие на обработку персональных данных в соответствии с{" "}
            <Link
              href="/privacy"
              target="_blank"
              className="text-accent hover:text-accent-hover underline underline-offset-2"
            >
              политикой конфиденциальности
            </Link>
            <span className="sr-only"> (откроется в новой вкладке)</span>
            <span className="text-muted"> *</span>
          </span>
        </label>
        {errors.consent && (
          <p id="consent-error" className="text-small text-danger mt-2">
            {errors.consent}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-caption text-muted">
          <span aria-hidden="true">*</span> — обязательные поля
        </p>
        <button
          type="submit"
          disabled={pending}
          aria-disabled={pending}
          className="liquid-primary rounded-control text-body inline-flex h-13 items-center justify-center gap-2 px-6 font-medium disabled:cursor-wait disabled:opacity-70"
        >
          {pending ? (
            <>
              <span
                aria-hidden="true"
                className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
              Отправляем…
            </>
          ) : mode === "test" ? (
            "Отправить (тестовый режим)"
          ) : (
            "Отправить заявку"
          )}
        </button>
      </div>
      <p aria-live="polite" className="sr-only">
        {pending ? "Отправляем заявку" : ""}
      </p>
    </form>
  );
}

function inputClass(error?: string) {
  return cn(
    "bg-surface text-ink placeholder:text-muted text-body rounded-field h-12 w-full border px-4 transition-colors outline-none scroll-mt-32",
    "focus-visible:border-accent focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2",
    error ? "border-danger" : "border-border-strong hover:border-ink/40",
  );
}

function Field({
  id,
  label,
  required,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="text-small font-medium">
        {label}
        {required && <span className="text-muted"> *</span>}
        {hint && <span className="text-muted font-normal"> · {hint}</span>}
      </label>
      <div className="mt-2">{children}</div>
      {hint && !error && (
        <span id={`${id}-hint`} className="sr-only">
          {hint}
        </span>
      )}
      {error && (
        <p id={`${id}-error`} className="text-small text-danger mt-2">
          {error}
        </p>
      )}
    </div>
  );
}
