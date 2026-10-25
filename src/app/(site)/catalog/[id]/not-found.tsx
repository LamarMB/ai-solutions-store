import { ButtonLink } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Section } from "@/components/ui/Section";

export default function SolutionNotFound() {
  return (
    <Section>
      <div className="max-w-prose">
        <p className="text-small text-muted font-medium">Ошибка 404</p>
        <h1 className="text-h1 mt-3 font-semibold">Решение не найдено</h1>
        <p className="text-muted mt-4">
          Такого решения нет в каталоге. Возможно, ссылка устарела или в ней
          опечатка.
        </p>
        <ButtonLink href="/catalog" className="mt-8">
          Перейти в каталог
          <Icon name="arrow-right" size={18} />
        </ButtonLink>
      </div>
    </Section>
  );
}
