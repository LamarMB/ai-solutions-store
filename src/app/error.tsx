"use client";

import { Button, ButtonLink } from "@/components/ui/Button";
import { Section } from "@/components/ui/Section";

/**
 * Непредвиденная ошибка на странице. Подробности ошибки сервера Next.js в
 * production не передаёт — показываем только код для поиска в логах.
 */
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <Section>
      <title>Ошибка · AI Solutions Store</title>
      <div className="max-w-prose" role="alert">
        <p className="text-small text-muted font-medium">Ошибка</p>
        <h1 className="text-h1 mt-3 font-semibold">Что-то пошло не так</h1>
        <p className="text-muted mt-4">
          Страницу не удалось показать. Попробуйте ещё раз или вернитесь в
          каталог.
        </p>
        {error.digest && (
          <p className="text-caption text-muted mt-3">
            Код ошибки: {error.digest}
          </p>
        )}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button onClick={() => retry()}>Попробовать ещё раз</Button>
          <ButtonLink href="/catalog" variant="secondary">
            Перейти в каталог
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}
