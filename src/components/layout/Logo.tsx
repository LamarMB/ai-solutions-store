import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { site } from "@/lib/site";

export function Logo() {
  return (
    <Link
      href="/"
      className="rounded-control text-ink flex items-center gap-2.5 font-semibold tracking-tight"
    >
      <span className="liquid-primary grid size-8 place-items-center rounded-full">
        <Icon name="sparkle" size={18} />
      </span>
      <span className="text-body">{site.name}</span>
    </Link>
  );
}
