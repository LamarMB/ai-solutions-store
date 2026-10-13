import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import type { ProcessStep } from "@/content/approach";

/** Краткая схема этапов: анализ → подбор → внедрение → поддержка. */
export function ProcessSteps({ steps }: { steps: readonly ProcessStep[] }) {
  return (
    <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {steps.map((step, index) => (
        <li key={step.id} className="relative">
          <Card className="h-full">
            <div className="flex items-center justify-between">
              <span className="glass grid size-11 place-items-center rounded-full">
                <Icon name={step.icon} size={20} />
              </span>
              <span
                aria-hidden="true"
                className="text-h2 text-border-strong font-semibold tabular-nums"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
            </div>
            <h3 className="text-h3 mt-5 font-semibold">
              <span className="sr-only">Шаг {index + 1}. </span>
              {step.title}
            </h3>
            <p className="text-small text-muted mt-2">{step.summary}</p>
          </Card>
        </li>
      ))}
    </ol>
  );
}
