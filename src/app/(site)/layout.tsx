import { SiteChrome } from "@/components/layout/SiteChrome";

/** Каркас публичного сайта: демо-полоса, шапка, подвал. */
export default function SiteLayout({ children }: LayoutProps<"/">) {
  return <SiteChrome>{children}</SiteChrome>;
}
