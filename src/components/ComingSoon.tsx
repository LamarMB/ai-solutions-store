import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Section } from "@/components/ui/Section";

/** Заглушка раздела, который появится на следующих этапах. */
export function ComingSoon({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <Section>
      <div className="max-w-prose">
        <Badge tone="accent">Раздел в разработке</Badge>
        <h1 className="text-h1 mt-5 font-semibold">{title}</h1>
        <p className="text-body text-muted mt-4">{text}</p>
        {children}
        <ButtonLink href="/" variant="secondary" className="mt-8">
          На главную
          <Icon name="arrow-right" size={18} />
        </ButtonLink>
      </div>
    </Section>
  );
}
