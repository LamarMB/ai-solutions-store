import type { CSSProperties, ReactNode } from "react";
import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icon";
import { benefits, type Benefit } from "@/content/home";
import { cn } from "@/lib/cn";
import { demoCaption, DemoShot } from "./Frames";
import { SectionIntro } from "./SectionIntro";

const byId = (id: Benefit["id"]) => benefits.find((b) => b.id === id)!;

/**
 * «Что получает клиника»: плитки разного размера. Две крупные — с настоящими
 * экранами демо (ответ о ценах в переписке и выбор времени в приложении).
 */
export function Benefits() {
  return (
    <section
      aria-labelledby="benefits-title"
      className="py-16 md:py-24 xl:py-28"
    >
      <Container>
        <SectionIntro
          id="benefits-title"
          eyebrow="Что получает клиника"
          title="Рутина администраторов — в одном помощнике"
          text="Типовые вопросы и запись берёт на себя ИИ-администратор. Сложное остаётся за людьми — и пациент сам решает, что им передать."
        />
        <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3 lg:grid-rows-[auto_auto]">
          <Tile
            benefit={byId("answers")}
            className="md:col-span-2"
            narrow
            i={0}
          >
            <div
              aria-hidden="true"
              className="pointer-events-none hidden overflow-hidden [mask-image:linear-gradient(180deg,#000_55%,transparent)] md:absolute md:top-8 md:right-8 md:block md:h-[calc(100%-2rem)] md:w-[17rem]"
            >
              <DemoShot id="chat-info" chatClassName="h-[26rem]" />
            </div>
          </Tile>
          <Tile
            benefit={byId("booking")}
            className="md:row-span-2 lg:col-start-3 lg:row-start-1"
            i={1}
          >
            <div
              aria-hidden="true"
              className="mt-8 h-56 overflow-hidden [mask-image:linear-gradient(180deg,#000_60%,transparent)] sm:h-64 lg:h-auto lg:flex-1"
            >
              <DemoShot
                id="mini-slots"
                className="mx-auto w-[78%] max-w-[16rem]"
              />
            </div>
          </Tile>
          <Tile benefit={byId("handoff")} i={2} />
          <Tile benefit={byId("safety")} i={3} />
        </div>
        <p className="text-caption text-muted mt-5">
          Экраны: {demoCaption(["chat-info", "mini-slots"])}
        </p>
      </Container>
    </section>
  );
}

function Tile({
  benefit,
  className,
  children,
  narrow = false,
  i,
}: {
  benefit: Benefit;
  className?: string;
  children?: ReactNode;
  /** Текст слева, экран справа (на широком экране). */
  narrow?: boolean;
  i: number;
}) {
  return (
    <article
      data-reveal
      style={{ "--reveal-i": i } as CSSProperties}
      className={cn(
        "panel relative flex flex-col overflow-hidden p-7 sm:p-8",
        className,
      )}
    >
      <div className={cn(narrow && "md:max-w-[52%] lg:max-w-[46%]")}>
        <span className="bg-accent-soft text-accent grid size-11 place-items-center rounded-2xl">
          <Icon name={benefit.icon} size={20} />
        </span>
        <h3 className="text-h3 mt-6 font-semibold">{benefit.title}</h3>
        <p className="text-muted mt-3 text-pretty">{benefit.text}</p>
      </div>
      {children}
    </article>
  );
}
