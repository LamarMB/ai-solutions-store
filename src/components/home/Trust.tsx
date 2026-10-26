import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icon";
import { principles } from "@/content/approach";

/**
 * «Честно о границах»: слева заголовок и ограничение платформы ВКонтакте,
 * справа — принципы работы (src/content/approach.ts) строками.
 */
export function Trust() {
  return (
    <section aria-labelledby="trust-title" className="py-16 md:py-24 xl:py-28">
      <Container className="grid gap-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-20">
        <div data-reveal className="lg:sticky lg:top-28 lg:self-start">
          <p className="eyebrow">Безопасность и честность</p>
          <h2
            id="trust-title"
            className="text-section mt-5 font-semibold text-balance"
          >
            Честно о границах системы
          </h2>
          <p className="text-lead text-muted mt-5 max-w-lg text-pretty">
            Показываем только то, что работает в демо-версии, и заранее говорим
            об ограничениях.
          </p>
          <div className="border-demo-ink/25 bg-demo-bg/60 text-small mt-8 flex max-w-lg gap-3 rounded-2xl border p-5">
            <Icon
              name="info"
              size={20}
              className="text-demo-ink mt-0.5 shrink-0"
            />
            <p className="text-ink/90">
              Переписку в сообщениях сообщества видят руководители сообщества
              ВКонтакте — это особенность платформы. Бот предупреждает об этом
              пациента в первом сообщении.
            </p>
          </div>
        </div>

        <ul className="divide-border border-border divide-y border-y">
          {principles.map((p) => (
            <li key={p.title} data-reveal className="flex gap-5 py-7">
              <span className="bg-accent-soft text-accent grid size-11 shrink-0 place-items-center rounded-2xl">
                <Icon name={p.icon} size={20} />
              </span>
              <div>
                <h3 className="text-h3 font-semibold">{p.title}</h3>
                <p className="text-muted mt-2 text-pretty">{p.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
