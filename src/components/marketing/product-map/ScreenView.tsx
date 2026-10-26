import type { ReactNode } from "react";
import type { DemoScreen } from "@/content/product-map";
import type { ChatLine } from "@/content/product-map-chats";
import { cn } from "@/lib/cn";

/**
 * Экран демо в рамке: телефон (приложение, переписка) или окно браузера
 * (панель). Только вымышленная клиника; ИИ-портреты подписаны.
 */
export function ScreenView({
  screen,
  className,
}: {
  screen: DemoScreen;
  className?: string;
}) {
  return (
    <figure className={cn("pm-screen-in", className)}>
      {screen.kind === "browser" ? (
        <BrowserFrame>
          {/* Статичный снимок демо-стенда из public/demo. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={screen.src}
            width={screen.width}
            height={screen.height}
            alt={screen.alt}
            loading="lazy"
            decoding="async"
            className="block h-auto w-full"
          />
        </BrowserFrame>
      ) : (
        <PhoneFrame>
          {screen.kind === "chat" ? (
            <ChatView lines={screen.lines} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={screen.src}
              width={screen.width}
              height={screen.height}
              alt={screen.alt}
              loading="lazy"
              decoding="async"
              className="block h-auto w-full"
            />
          )}
        </PhoneFrame>
      )}
      <figcaption className="text-caption text-muted mt-3 text-center text-balance">
        {screen.title} · демо, вымышленная клиника
        {screen.kind !== "chat" && screen.aiPhotos && (
          <> · фото врачей созданы ИИ</>
        )}
        {screen.kind === "chat" && <> · реплики демо-бота</>}
      </figcaption>
    </figure>
  );
}

function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="pm-phone mx-auto w-full max-w-[17rem]">
      <div className="bg-bg overflow-hidden rounded-[1.6rem]">{children}</div>
    </div>
  );
}

function BrowserFrame({ children }: { children: ReactNode }) {
  return (
    <div className="pm-browser overflow-hidden">
      <div
        aria-hidden="true"
        className="border-border flex items-center gap-1.5 border-b px-3 py-2"
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

function ChatView({ lines }: { lines: readonly ChatLine[] }) {
  return (
    <div className="flex h-[30rem] flex-col">
      <div className="border-border flex items-center gap-2 border-b px-3 py-2.5">
        <span
          aria-hidden="true"
          className="bg-accent-soft text-accent text-caption grid size-7 place-items-center rounded-full font-semibold"
        >
          ДМ
        </span>
        <span className="text-small leading-tight font-medium">
          Демо-Мед
          <span className="text-caption text-muted block font-normal">
            сообщения сообщества
          </span>
        </span>
      </div>
      <ol className="pm-chat flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        {lines.map((line, i) => (
          <li
            key={i}
            className={cn(
              "flex flex-col",
              line.from === "patient" ? "items-end" : "items-start",
            )}
          >
            <span className="sr-only">
              {line.from === "patient" ? "Пациент: " : "Бот: "}
            </span>
            <p
              className={cn(
                "text-caption max-w-[88%] rounded-2xl px-3 py-2 whitespace-pre-line",
                line.from === "patient"
                  ? "bg-accent text-accent-ink rounded-br-md"
                  : "bg-surface-2 text-ink rounded-bl-md",
              )}
            >
              {line.text}
            </p>
            {line.buttons && line.buttons.length > 0 && (
              <ul
                aria-label="Кнопки бота"
                className="mt-1.5 flex max-w-[92%] flex-wrap gap-1"
              >
                {line.buttons.map((b) => (
                  <li
                    key={b}
                    className="border-border-strong text-caption text-muted rounded-full border px-2 py-0.5"
                  >
                    {b}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
