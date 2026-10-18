"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/components/admin/client";
import { ErrorNote, Field, Input } from "@/components/admin/ui";
import { Button } from "@/components/ui/Button";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(undefined);
    try {
      await api("login", {
        method: "POST",
        body: { login: form.get("login"), password: form.get("password") },
      });
      router.replace("/admin");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось войти.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {error && <ErrorNote message={error} />}
      <Field label="Логин">
        {(props) => (
          <Input
            {...props}
            name="login"
            autoComplete="username"
            required
            autoFocus
          />
        )}
      </Field>
      <Field label="Пароль">
        {(props) => (
          <Input
            {...props}
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        )}
      </Field>
      <Button type="submit" disabled={busy} className="mt-2">
        {busy ? "Вхожу…" : "Войти"}
      </Button>
    </form>
  );
}
