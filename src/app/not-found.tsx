import { ButtonLink } from "@/components/ui/Button";
import { Section } from "@/components/ui/Section";

export default function NotFound() {
  return (
    <Section>
      <div className="max-w-prose">
        <p className="text-small text-muted font-medium">Ошибка 404</p>
        <h1 className="text-h1 mt-3 font-semibold">Страница не найдена</h1>
        <p className="text-muted mt-4">
          Такой страницы нет. Проверьте адрес или перейдите в каталог.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/catalog">Перейти в каталог</ButtonLink>
          <ButtonLink href="/" variant="secondary">
            На главную
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}
