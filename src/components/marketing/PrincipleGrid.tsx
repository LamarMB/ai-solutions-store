import { Icon } from "@/components/ui/Icon";
import type { Principle } from "@/content/approach";

export function PrincipleGrid({ items }: { items: readonly Principle[] }) {
  return (
    <ul className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <li key={item.title} className="flex gap-4">
          <span className="glass text-accent grid size-11 shrink-0 place-items-center rounded-full">
            <Icon name={item.icon} size={20} />
          </span>
          <div>
            <h3 className="text-body font-semibold">{item.title}</h3>
            <p className="text-small text-muted mt-1.5">{item.text}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
