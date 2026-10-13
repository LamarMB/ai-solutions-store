import { Logo } from "@/components/layout/Logo";
import { MobileMenu } from "@/components/layout/MobileMenu";
import { NavLinks } from "@/components/layout/NavLinks";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icon";
import { headerActions } from "@/config/navigation";

export function SiteHeader() {
  return (
    <header className="glass-bar border-border sticky top-0 z-40 border-b">
      <Container className="flex h-16 items-center gap-4">
        <Logo />

        <nav aria-label="Основная" className="ml-6 hidden lg:block">
          <NavLinks />
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden lg:block">
            <ButtonLink
              href={headerActions.consultant.href}
              variant="ghost"
              size="sm"
            >
              <Icon name="chat" size={18} />
              {headerActions.consultant.label}
            </ButtonLink>
          </div>
          <div className="hidden sm:block">
            <ButtonLink href={headerActions.request.href} size="sm">
              {headerActions.request.label}
            </ButtonLink>
          </div>
          <div className="lg:hidden">
            <MobileMenu />
          </div>
        </div>
      </Container>
    </header>
  );
}
