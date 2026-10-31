"use client";

import { Fragment, useState, type CSSProperties } from "react";
import { Icon } from "@/components/ui/Icon";
import type { WorkflowNode } from "@/content/home";
import { cn } from "@/lib/cn";

/**
 * Схема работы в виде блоков со связями: в строку на широком экране, столбцом
 * на узком. Подробности блока раскрываются по нажатию (кнопка с aria-expanded).
 * Это иллюстрация того, как работает продукт, а не настоящий сценарий
 * автоматизации. Анимация связей отключается при reduced-motion.
 */
export function WorkflowScheme({ nodes }: { nodes: readonly WorkflowNode[] }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <ol
      aria-label="Схема работы"
      className="flow-scheme flex flex-col items-stretch lg:flex-row lg:items-start"
    >
      {nodes.map((node, i) => {
        const expanded = open === node.id;
        const detailsId = `workflow-${node.id}`;
        return (
          <Fragment key={node.id}>
            {i > 0 && (
              <li aria-hidden="true" className="flow-link">
                <span className="flow-link-dot" />
              </li>
            )}
            <li
              data-reveal
              style={{ "--reveal-i": i } as CSSProperties}
              className="min-w-0 lg:flex-1"
            >
              <div
                className={cn(
                  "flow-node bg-surface relative rounded-2xl border transition-colors",
                  expanded
                    ? "border-accent/60"
                    : "border-border hover:border-border-strong",
                )}
              >
                <span aria-hidden="true" className="flow-port flow-port-in" />
                <span aria-hidden="true" className="flow-port flow-port-out" />
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={detailsId}
                  onClick={() => setOpen(expanded ? null : node.id)}
                  className="focus-visible:outline-accent w-full rounded-2xl p-5 text-left focus-visible:outline-2"
                >
                  <span className="flex items-center gap-3">
                    <span className="bg-accent-soft text-accent grid size-10 shrink-0 place-items-center rounded-xl">
                      <Icon name={node.icon} size={20} />
                    </span>
                    <span className="font-semibold text-balance">
                      {node.title}
                    </span>
                  </span>
                  <span className="text-small text-muted mt-3 block text-pretty">
                    {node.text}
                  </span>
                  <span className="text-caption text-accent mt-4 flex items-center gap-1 font-medium">
                    {expanded ? "Скрыть" : "Подробнее"}
                    <Icon
                      name="chevron-right"
                      size={14}
                      className={cn(
                        "transition-transform",
                        expanded && "rotate-90",
                      )}
                    />
                  </span>
                </button>
                <div id={detailsId} hidden={!expanded} className="px-5 pb-5">
                  <ul className="border-border space-y-2 border-t pt-4">
                    {node.details.map((item) => (
                      <li key={item} className="text-small flex gap-2">
                        <Icon
                          name="check"
                          size={16}
                          className="text-accent mt-0.5 shrink-0"
                        />
                        <span className="text-ink/90">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              {node.note && (
                <p className="text-caption text-muted mt-3 flex items-center justify-center gap-1.5">
                  <Icon name="shield" size={14} className="text-accent" />
                  {node.note}
                </p>
              )}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
