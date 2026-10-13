import { ButtonLink } from "@/components/ui/Button";
import { DemoBadge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Section } from "@/components/ui/Section";
import { headerActions, mainNav } from "@/config/navigation";
import { site } from "@/lib/site";

export default function Home() {
  return (
    <Section className="flex flex-1 items-center">
      <div className="max-w-3xl">
        <DemoBadge />
        <h1 className="text-display mt-6 font-semibold text-balance">
          {site.name}
        </h1>
        <p className="text-h3 text-muted mt-5 max-w-prose font-normal">
          Сайт в разработке ·{" "}
          <span className="whitespace-nowrap">демо-версия</span>
        </p>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <ButtonLink href={mainNav[0].href} size="lg">
            Перейти в каталог
            <Icon name="arrow-right" size={18} />
          </ButtonLink>
          <ButtonLink
            href={headerActions.consultant.href}
            variant="secondary"
            size="lg"
          >
            <Icon name="chat" size={18} />
            {headerActions.consultant.label}
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}
