import type { ReactNode } from "react";
import { ChatView } from "@/components/marketing/product-map/ScreenView";
import { getScreen, type DemoScreen } from "@/content/product-map";
import { cn } from "@/lib/cn";

/** Экран демо-стенда по id; неизвестный id — ошибка сборки, а не пустое место. */
export function screen(id: string): DemoScreen {
  const found = getScreen(id);
  if (!found) throw new Error(`Нет экрана демо: ${id}`);
  return found;
}

/** Окно браузера со снимком панели клиники. */
export function BrowserFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("frame-browser overflow-hidden", className)}>
      <div
        aria-hidden="true"
        className="border-border flex items-center gap-1.5 border-b px-3.5 py-2.5"
      >
        <span className="bg-border-strong size-2 rounded-full" />
        <span className="bg-border-strong size-2 rounded-full" />
        <span className="bg-border-strong size-2 rounded-full" />
        <span className="text-caption text-muted ml-3 truncate">
          Панель клиники · демо
        </span>
      </div>
      {children}
    </div>
  );
}

/** Телефон: внутри снимок приложения или переписка с ботом. */
export function PhoneFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("frame-phone", className)}>
      <div className="bg-bg overflow-hidden rounded-[1.75rem]">{children}</div>
    </div>
  );
}

/**
 * Экран демо в подходящей рамке. `priority` — для первого экрана (без
 * отложенной загрузки), `chatClassName` — высота переписки.
 */
export function DemoShot({
  id,
  priority = false,
  className,
  chatClassName,
}: {
  id: string;
  priority?: boolean;
  className?: string;
  chatClassName?: string;
}) {
  const s = screen(id);
  if (s.kind === "chat") {
    return (
      <PhoneFrame className={className}>
        <ChatView lines={s.lines} className={chatClassName} />
      </PhoneFrame>
    );
  }
  const img = (
    // Статичный снимок демо-стенда из public/demo (вымышленная клиника).
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={s.src}
      width={s.width}
      height={s.height}
      alt={s.alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className="block h-auto w-full"
    />
  );
  return s.kind === "browser" ? (
    <BrowserFrame className={className}>{img}</BrowserFrame>
  ) : (
    <PhoneFrame className={className}>{img}</PhoneFrame>
  );
}

/** Подпись к экранам: демо, вымышленная клиника, при необходимости — ИИ-фото. */
export function demoCaption(ids: readonly string[]): string {
  const screens = ids.map(screen);
  const parts = ["демо-версия, вымышленная клиника"];
  if (screens.some((s) => s.kind === "chat")) parts.push("реплики демо-бота");
  if (screens.some((s) => s.kind !== "chat" && s.aiPhotos))
    parts.push("фото врачей созданы ИИ");
  return parts.join(" · ");
}
