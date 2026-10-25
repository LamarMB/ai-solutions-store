import { Icon } from "@/components/ui/Icon";
import { STATUS_LABELS, type MapStatus } from "@/content/product-map";
import { cn } from "@/lib/cn";

/** Статус возможности: работает в демо, настраивается, в планах. */
export function StatusBadge({
  status,
  className,
}: {
  status: MapStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-caption inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium",
        status === "working" &&
          "border-accent/40 bg-accent-soft/60 text-accent",
        status === "configurable" && "border-pm-gold/40 text-pm-gold",
        status === "planned" && "border-border-strong text-muted border-dashed",
        className,
      )}
    >
      {status === "working" && (
        <span aria-hidden="true" className="bg-accent size-1.5 rounded-full" />
      )}
      {status === "configurable" && <Icon name="wrench" size={12} />}
      {status === "planned" && <Icon name="clock" size={12} />}
      {STATUS_LABELS[status]}
    </span>
  );
}
