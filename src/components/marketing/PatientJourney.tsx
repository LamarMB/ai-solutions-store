import type { JourneyStep } from "@/content/patient-journey";

/**
 * Будущий сценарий пациента — нумерованные шаги и ключевой принцип.
 * Только описание: ничего не записывает и не собирает.
 */
export function PatientJourney({ steps }: { steps: readonly JourneyStep[] }) {
  return (
    <div>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className="rounded-card border-border bg-surface flex flex-col border p-5 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="liquid-primary text-small grid size-8 place-items-center rounded-full font-semibold">
                {index + 1}
              </span>
              {step.optional && (
                <span className="text-caption text-muted border-border rounded-full border px-2.5 py-0.5">
                  необязательно
                </span>
              )}
            </div>
            <h3 className="text-body mt-4 font-semibold">{step.title}</h3>
            <p className="text-small text-muted mt-1.5">{step.text}</p>
          </li>
        ))}
      </ol>
      <p className="glass rounded-card text-body mt-6 p-5 sm:p-6">
        <span className="font-semibold">Главный принцип:</span> дополнительные
        вопросы не задерживают запись. Пациент может пропустить их и вернуться
        позже.
      </p>
    </div>
  );
}
