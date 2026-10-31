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
import { submitRequest } from "@/app/(site)/request/actions";
import { Icon } from "@/components/ui/Icon";
import { externalLinkProps, telegram } from "@/config/contact";
import {
  DEMO_FORM,
  DemoRequestSchema,
  fieldErrors,
  FORM_KIND_FIELD,
  formDataToInput,
  SERVICE_FIELDS,
  type ContactMethod,
  type RequestField,
} from "@/requests/schema";
import { INITIAL_STATE } from "@/requests/state";
import { cn } from "@/lib/cn";

const METHODS: {
  id: ContactMethod;
  label: string;
  field: string;
  placeholder: string;
}[] = [
  {
    id: "telegram",
    label: "Telegram",
    field: "Ваш Telegram",
    placeholder: "@clinic_admin",
  },
  {
    id: "phone",
    label: "Телефон",
    field: "Ваш телефон",
    placeholder: "+7 900 000-00-00",
  },
  {
    id: "email",
    label: "Email",
    field: "Ваш email",
    placeholder: "admin@clinic.ru",
  },
];
const FIELD_ORDER: RequestField[] = ["name", "company", "contact", "consent"];

/**
 * Короткая заявка на демонстрацию: имя, клиника, способ связи, согласие.
 * Показывается, только когда приём включён (доставка владельцу настроена и
 * политика опубликована). Успех — только после ответа сервера о доставке;
 * при ошибке поля сохраняются и предлагается Telegram. Защита от спама и
 * повторов — общая с /request (src/requests/service.ts).
 */
export function DemoRequestForm() {
  const [state, formAction, pending] = useActionState(
    submitRequest,
    INITIAL_STATE,
  );
  const [session, setSession] = useState<{ id: string; at: number }>();
  const [method, setMethod] = useState<ContactMethod>("telegram");
  const [clientErrors, setClientErrors] = useState<
    Partial<Record<RequestField, string>>
  >({});
  const formRef = useRef<HTMLFormElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status !== "idle") statusRef.current?.focus();
  }, [state]);

  const errors = {
    ...(state.status === "invalid" ? state.fieldErrors : {}),
    ...clientErrors,
  };

  // Ключ отправки и время начала заполнения — при первом касании формы
  // (страница статическая, на сервере их не создать).
  const start = () => {
    if (!session) setSession({ id: crypto.randomUUID(), at: Date.now() });
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !session) return;
    const formData = new FormData(event.currentTarget);
    const parsed = DemoRequestSchema.safeParse(formDataToInput(formData));
    if (!parsed.success) {
      const next = fieldErrors(parsed.error);
      setClientErrors(next);
      const first = FIELD_ORDER.find((f) => next[f]);
      formRef.current
        ?.querySelector<HTMLElement>(`[data-field="${first}"]`)
        ?.focus();
      return;
    }
    setClientErrors({});
    startTransition(() => formAction(formData));
  };

  if (state.status === "accepted") {
    return (
      <div
        ref={statusRef}
        tabIndex={-1}
        role="status"
        className="border-border bg-bg/60 rounded-2xl border p-6 outline-none"
      >
        {state.mode === "live" ? (
          <>
            <p className="flex items-center gap-2 font-semibold">
              <Icon name="check" size={20} className="text-accent" />
              Заявка отправлена. Мы скоро с вами свяжемся
            </p>
            <p className="text-small text-muted mt-3">
              Номер заявки: {state.reference}.
            </p>
          </>
        ) : (
          <p className="text-small text-muted">
            Приём заявок через сайт сейчас не работает — заявка не отправлена.
            Напишите нам в Telegram{" "}
            <a
              href={telegram.href}
              {...externalLinkProps}
              className="text-accent font-medium"
            >
              {telegram.handle}
            </a>
            .
          </p>
        )}
      </div>
    );
  }

  const serverMessage =
    state.status === "idle" || state.status === "invalid"
      ? state.status === "invalid"
        ? state.message
        : null
      : state.message;
  const current = METHODS.find((m) => m.id === method)!;
  const input =
    "bg-bg border-border focus:border-accent w-full rounded-xl border px-4 py-3 outline-none transition-colors";

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={onSubmit}
      onFocusCapture={start}
      noValidate
      aria-labelledby="demo-form-title"
      className="border-border bg-bg/60 relative grid gap-5 rounded-2xl border p-6"
    >
      <h3 id="demo-form-title" className="font-semibold">
        Заявка на демонстрацию
      </h3>
      <input type="hidden" name={FORM_KIND_FIELD} value={DEMO_FORM} />
      <input
        type="hidden"
        name={SERVICE_FIELDS.startedAt}
        value={session?.at ?? ""}
      />
      <input
        type="hidden"
        name={SERVICE_FIELDS.submissionId}
        value={session?.id ?? ""}
      />
      <input type="hidden" name="solutionId" value="clinic-ai-administrator" />
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

      <div ref={statusRef} tabIndex={-1} className="outline-none">
        {serverMessage && (
          <p
            role="alert"
            className="border-danger/40 text-danger text-small bg-danger/10 rounded-xl border p-4"
          >
            {serverMessage} Введённые данные сохранены в форме. Можно также
            написать нам в Telegram{" "}
            <a
              href={telegram.href}
              {...externalLinkProps}
              className="font-medium underline"
            >
              {telegram.handle}
            </a>
            .
          </p>
        )}
      </div>

      <Field label="Имя" error={errors.name} id="demo-name">
        <input
          id="demo-name"
          name="name"
          data-field="name"
          autoComplete="name"
          maxLength={100}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? "demo-name-error" : undefined}
          className={input}
        />
      </Field>
      <Field label="Клиника" error={errors.company} id="demo-company">
        <input
          id="demo-company"
          name="company"
          data-field="company"
          autoComplete="organization"
          maxLength={150}
          aria-invalid={Boolean(errors.company)}
          aria-describedby={errors.company ? "demo-company-error" : undefined}
          className={input}
        />
      </Field>

      <fieldset>
        <legend className="text-small mb-2 font-medium">
          Как с вами связаться
        </legend>
        <div className="flex flex-wrap gap-2">
          {METHODS.map((m) => (
            <label
              key={m.id}
              className={cn(
                "text-small cursor-pointer rounded-full border px-4 py-2 transition-colors has-[:focus-visible]:outline-2",
                method === m.id
                  ? "border-accent bg-accent-soft text-ink"
                  : "border-border text-muted hover:border-border-strong",
              )}
            >
              <input
                type="radio"
                name="contactMethod"
                value={m.id}
                checked={method === m.id}
                onChange={() => setMethod(m.id)}
                className="sr-only"
              />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label={current.field} error={errors.contact} id="demo-contact">
        <input
          id="demo-contact"
          name="contact"
          data-field="contact"
          type={
            method === "email" ? "email" : method === "phone" ? "tel" : "text"
          }
          inputMode={
            method === "phone" ? "tel" : method === "email" ? "email" : "text"
          }
          autoComplete={
            method === "email" ? "email" : method === "phone" ? "tel" : "off"
          }
          placeholder={current.placeholder}
          maxLength={254}
          aria-invalid={Boolean(errors.contact)}
          aria-describedby={errors.contact ? "demo-contact-error" : undefined}
          className={input}
        />
      </Field>

      <div>
        <label className="text-small flex items-start gap-3">
          <input
            type="checkbox"
            name="consent"
            data-field="consent"
            aria-invalid={Boolean(errors.consent)}
            aria-describedby={errors.consent ? "demo-consent-error" : undefined}
            className="accent-accent mt-1 size-4 shrink-0"
          />
          <span className="text-muted">
            Согласен на обработку указанных данных для связи по заявке, включая
            передачу оператору через Telegram, — в соответствии с{" "}
            <Link
              href="/privacy"
              className="text-accent hover:text-accent-hover"
            >
              политикой обработки персональных данных
            </Link>
            .
          </span>
        </label>
        {errors.consent && (
          <p id="demo-consent-error" className="text-danger text-small mt-2">
            {errors.consent}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="liquid-primary rounded-control px-6 py-3 font-semibold disabled:opacity-60"
      >
        {pending ? "Отправляем…" : "Получить демонстрацию"}
      </button>
    </form>
  );
}

function Field({
  label,
  error,
  id,
  children,
}: {
  label: string;
  error?: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-small mb-2 block font-medium">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-danger text-small mt-2">
          {error}
        </p>
      )}
    </div>
  );
}
