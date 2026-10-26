import type { CSSProperties } from "react";
import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icon";
import { staffFeatures } from "@/content/home";
import { demoCaption, DemoShot } from "./Frames";
import { SectionIntro } from "./SectionIntro";

/**
 * «Панель клиники»: широкая карточка с главной панели и три карточки со
 * снимками записей, расписания и обращений. Снимки — демо-стенд.
 */
export function StaffPanel() {
  const [main, ...rest] = staffFeatures;
  return (
    <section aria-labelledby="staff-title" className="py-16 md:py-24 xl:py-28">
      <Container>
        <SectionIntro
          id="staff-title"
          eyebrow="Для персонала"
          title="Панель клиники: всё, что нужно администратору и врачу"
          text="Записи из всех каналов, расписание, врачи, услуги и обращения — в одном месте. Бот и приложение сразу работают по данным панели."
        />

        <article
          data-reveal
          className="panel mt-14 grid overflow-hidden lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]"
        >
          <div className="flex flex-col justify-between gap-8 p-8 sm:p-10">
            <div>
              <h3 className="text-h2 font-semibold">{main.title}</h3>
              <p className="text-lead text-muted mt-4 text-pretty">
                {main.text}
              </p>
            </div>
            <p className="text-small text-muted flex items-start gap-3">
              <span className="bg-accent-soft text-accent grid size-9 shrink-0 place-items-center rounded-xl">
                <Icon name="users" size={18} />
              </span>
              <span className="pt-1">
                Роли: владелец, администратор и врач — каждый видит только своё.
                Врач — свои приёмы, без медицинских сведений без согласия
                пациента.
              </span>
            </p>
          </div>
          <div className="pt-2 pl-8 sm:pl-10 lg:pt-10">
            <DemoShot
              id={main.screenId}
              className="rounded-r-none rounded-b-none"
            />
          </div>
        </article>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {rest.map((f, i) => (
            <article
              key={f.screenId}
              data-reveal
              style={{ "--reveal-i": i + 1 } as CSSProperties}
              className="panel flex flex-col overflow-hidden"
            >
              <div className="p-7 sm:p-8 sm:pb-0">
                <h3 className="text-h3 font-semibold">{f.title}</h3>
                <p className="text-muted mt-3 text-pretty">{f.text}</p>
              </div>
              <div className="mt-8 hidden h-52 overflow-hidden pl-8 sm:block">
                <DemoShot
                  id={f.screenId}
                  className="w-[150%] max-w-none rounded-r-none"
                />
              </div>
            </article>
          ))}
        </div>
        <p className="text-caption text-muted mt-5">
          Снимки панели: {demoCaption(staffFeatures.map((f) => f.screenId))}
        </p>
      </Container>
    </section>
  );
}
