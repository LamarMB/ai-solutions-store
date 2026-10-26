import { Container } from "@/components/ui/Container";
import { faq } from "@/content/home";

/** Частые вопросы: нативный details/summary — работает без JavaScript. */
export function Faq() {
  return (
    <section aria-labelledby="faq-title" className="py-16 md:py-24 xl:py-28">
      <Container className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20">
        <div data-reveal>
          <p className="eyebrow">Вопросы</p>
          <h2
            id="faq-title"
            className="text-section mt-5 font-semibold text-balance"
          >
            Частые вопросы клиник
          </h2>
        </div>
        <div className="border-border border-t">
          {faq.map((item) => (
            <details
              key={item.id}
              className="faq-item border-border group border-b"
            >
              <summary className="hover:text-accent flex cursor-pointer list-none items-center justify-between gap-6 py-6 text-[1.125rem] font-medium transition-colors">
                {item.question}
                <span
                  aria-hidden="true"
                  className="faq-icon border-border-strong text-accent grid size-8 shrink-0 place-items-center rounded-full border transition-transform duration-300"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                  >
                    <path d="M7 1v12M1 7h12" />
                  </svg>
                </span>
              </summary>
              <p className="text-muted max-w-2xl pb-7 text-pretty">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}
