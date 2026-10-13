import { ButtonLink } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { headerActions, mainNav } from "@/config/navigation";

/** Финальный призыв к действию: каталог или заявка. */
export function CtaPanel({
  title = "Посмотрите, какие задачи можно автоматизировать",
  text = "Выберите решение в каталоге или оставьте заявку — обсудим задачу и подходящий пакет.",
}: {
  title?: string;
  text?: string;
}) {
  return (
    <div className="glass rounded-panel relative overflow-hidden px-6 py-12 text-center sm:px-12 sm:py-16">
      {/* Мягкий блик внутри панели */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-48 max-w-xl rounded-full bg-[radial-gradient(closest-side,rgb(165_163_255/0.25),transparent)]"
      />
      <h2 className="text-h2 relative mx-auto max-w-2xl font-semibold text-balance">
        {title}
      </h2>
      <p className="text-muted relative mx-auto mt-4 max-w-xl">{text}</p>
      <div className="relative mt-8 flex flex-col justify-center gap-3 sm:flex-row">
        <ButtonLink href={mainNav[0].href} size="lg">
          Смотреть решения
          <Icon name="arrow-right" size={18} />
        </ButtonLink>
        <ButtonLink
          href={headerActions.request.href}
          variant="secondary"
          size="lg"
        >
          {headerActions.request.label}
        </ButtonLink>
      </div>
    </div>
  );
}
