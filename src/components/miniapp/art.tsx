import { MaIcon, specialtyIcon } from "@/components/miniapp/icons";
import { cn } from "@/lib/cn";

/*
 * Изображения Mini App без фотографий. В базе нет фотографий врачей, а
 * вымышленным врачам нельзя приписывать снимки реальных людей, поэтому —
 * монограммы и линейная иллюстрация. Список изображений, которые можно
 * подготовить отдельно, — docs/vk-mini-app-deploy.md, раздел «Изображения».
 */

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

const SIZES = {
  sm: "size-12 rounded-[14px] text-[1.05rem]",
  md: "size-16 rounded-[18px] text-[1.35rem]",
  lg: "size-32 rounded-full text-[2.75rem]",
} as const;

/** Монограмма врача вместо фотографии; значок направления — в углу. */
export function DoctorPortrait({
  name,
  specialtyId,
  size = "md",
}: {
  name: string;
  specialtyId?: string;
  size?: keyof typeof SIZES;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "text-accent font-display relative flex shrink-0 items-center justify-center font-semibold",
        // Крупный портрет стоит на фоне цвета «героя» — ему белая подложка.
        size === "lg" ? "bg-surface shadow-raised" : "bg-hero",
        SIZES[size],
      )}
    >
      {initials(name)}
      {specialtyId && size !== "sm" && (
        <span
          className={cn(
            "bg-surface text-accent shadow-card absolute flex items-center justify-center rounded-full",
            size === "lg"
              ? "right-0 bottom-0 size-10"
              : "-right-1 -bottom-1 size-7",
          )}
        >
          <MaIcon
            name={specialtyIcon(specialtyId)}
            size={size === "lg" ? 20 : 15}
          />
        </span>
      )}
    </span>
  );
}

/** Знак «Демо-Мед». */
export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="bg-accent text-accent-ink flex size-10 items-center justify-center rounded-[12px]">
        <MaIcon name="leaf" size={22} strokeWidth={1.7} />
      </span>
      <span className="leading-tight">
        <span className="font-display block text-[1.125rem] font-semibold">
          Демо-Мед
        </span>
        <span className="text-caption text-muted block">
          демонстрационная клиника
        </span>
      </span>
    </span>
  );
}

/**
 * Иллюстрация приветственного блока: мягкие круги и линейный фонендоскоп в
 * цветах темы. Без фотографий и внешних загрузок.
 */
export function HeroArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 160 180"
      aria-hidden
      focusable="false"
      className={className}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="96" cy="86" r="70" fill="var(--surface)" opacity="0.7" />
      <circle cx="96" cy="86" r="50" fill="var(--accent-soft)" />
      <path
        d="M30 150c22-6 40-24 48-48"
        stroke="var(--accent)"
        strokeOpacity="0.18"
        strokeWidth="1.5"
      />
      <g stroke="var(--accent)" strokeWidth="3.2">
        <path d="M74 40v26a20 20 0 0 0 40 0V40" />
        <path d="M70 40h8M110 40h8" />
        <path d="M94 86v18a24 24 0 0 0 48 0v-8" />
      </g>
      <circle
        cx="142"
        cy="88"
        r="9"
        stroke="var(--accent)"
        strokeWidth="3.2"
        fill="var(--surface)"
      />
      <circle cx="142" cy="88" r="3" fill="var(--accent)" />
    </svg>
  );
}
