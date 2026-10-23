"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ROLE_TITLES } from "@/admin/permissions";
import type { StaffRole } from "@/bot/storage/admin-store";
import { api, ApiError } from "@/components/admin/client";
import { ErrorNote, Field, Input, Loading } from "@/components/admin/ui";
import { Button } from "@/components/ui/Button";

/**
 * Принятие приглашения. Токен — во фрагменте адреса (#…): браузер не
 * отправляет его серверу при открытии страницы, только в теле запроса.
 */
export function InviteForm() {
  const tokenRef = useRef<string>(undefined);
  const [token, setToken] = useState<string>();
  const [invite, setInvite] = useState<{ login: string; role: StaffRole }>();
  const [error, setError] = useState<string>();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Ref переживает повторный запуск эффекта (StrictMode): хэш уже очищен.
    tokenRef.current ??= window.location.hash.slice(1);
    const value = tokenRef.current;
    // Токен убирается из адресной строки и истории браузера.
    if (value) window.history.replaceState(null, "", window.location.pathname);
    const check = value
      ? api<{ login: string; role: StaffRole }>("invite/info", {
          method: "POST",
          body: { token: value },
        })
      : Promise.reject(
          new ApiError(
            "В ссылке нет приглашения. Попросите владельца прислать новое.",
            0,
          ),
        );
    check
      .then((info) => {
        if (cancelled) return;
        setToken(value);
        setInvite(info);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(e instanceof ApiError ? e.message : "Ошибка проверки.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("password") !== form.get("repeat")) {
      setFields({ repeat: "Пароли не совпадают" });
      return;
    }
    setBusy(true);
    setError(undefined);
    setFields({});
    try {
      await api("invite/accept", {
        method: "POST",
        body: { token, password: form.get("password") },
      });
      setDone(true);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setFields(e.fields);
      } else setError("Не удалось сохранить пароль.");
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <div className="flex flex-col gap-4">
        <p>Пароль сохранён. Войдите с логином «{invite?.login}».</p>
        <Link href="/admin/login" className="text-accent font-medium">
          Перейти ко входу
        </Link>
      </div>
    );
  if (error && !invite) return <ErrorNote message={error} />;
  if (!invite) return <Loading label="Проверяю приглашение…" />;
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <p className="text-muted">
        Логин: <span className="text-ink font-medium">{invite.login}</span>
        <br />
        Роль: {ROLE_TITLES[invite.role]}
      </p>
      {error && <ErrorNote message={error} />}
      <Field
        label="Новый пароль"
        hint="Не короче 10 символов, буквы и цифры."
        error={fields.password}
      >
        {(props) => (
          <Input
            {...props}
            name="password"
            type="password"
            autoComplete="new-password"
            required
          />
        )}
      </Field>
      <Field label="Повторите пароль" error={fields.repeat}>
        {(props) => (
          <Input
            {...props}
            name="repeat"
            type="password"
            autoComplete="new-password"
            required
          />
        )}
      </Field>
      <Button type="submit" disabled={busy} className="mt-2">
        {busy ? "Сохраняю…" : "Сохранить пароль"}
      </Button>
    </form>
  );
}
