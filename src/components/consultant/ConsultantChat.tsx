"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { askConsultant } from "@/app/consultant/actions";
import type { RecommendationView } from "@/consultant/recommendations";
import { LIMITS, type ChatTurn } from "@/consultant/types";
import { RecommendationCard } from "@/components/consultant/RecommendationCard";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

type UiMessage = {
  id: number;
  role: "user" | "assistant";
  text: string;
  recommendations?: RecommendationView[];
  followUps?: string[];
  redacted?: boolean;
};

type ChatError = { message: string; retryable: boolean };

const WELCOME =
  "Здравствуйте! Я помогу подобрать решение из каталога. Опишите задачу своими словами: какой процесс хотите ускорить или автоматизировать и в какой отрасли работаете.";

export function ConsultantChat({ examples }: { examples: readonly string[] }) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<ChatError | null>(null);
  const [pending, startTransition] = useTransition();
  const nextId = useRef(1);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Прокручиваем только окно диалога (не страницу) и только когда есть сообщения.
  useEffect(() => {
    const log = logRef.current;
    if (log && (messages.length > 0 || error)) log.scrollTop = log.scrollHeight;
  }, [messages, pending, error]);

  /** Отправка истории; при ошибке сообщение пользователя остаётся для повтора. */
  const request = (history: UiMessage[]) => {
    setError(null);
    const turns: ChatTurn[] = history
      .slice(-LIMITS.turnsMax)
      .map(({ role, text }) => ({ role, text }));
    startTransition(async () => {
      try {
        const res = await askConsultant(turns);
        if (res.status === "ok") {
          setMessages((prev) => [
            ...prev,
            {
              id: nextId.current++,
              role: "assistant",
              text: res.text,
              recommendations: res.recommendations,
              followUps: res.followUps,
              redacted: res.redacted,
            },
          ]);
        } else {
          setError({
            message: res.message,
            retryable: res.status !== "invalid",
          });
        }
      } catch {
        setError({
          message: "Не удалось связаться с сервером. Проверьте соединение.",
          retryable: true,
        });
      }
    });
  };

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || pending || trimmed.length > LIMITS.messageMax) return;
    const history: UiMessage[] = [
      ...messages,
      { id: nextId.current++, role: "user", text: trimmed },
    ];
    setMessages(history);
    setInput("");
    request(history);
    inputRef.current?.focus({ preventScroll: true });
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send(input);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      send(input);
    }
  };

  const reset = () => {
    setMessages([]);
    setError(null);
    setInput("");
    inputRef.current?.focus({ preventScroll: true });
  };

  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");
  const quickReplies =
    messages.length === 0 ? examples : (lastAssistant?.followUps ?? []);
  const showQuickReplies =
    !pending &&
    !error &&
    (messages.length === 0 || messages.at(-1)?.role === "assistant");
  const tooLong = input.trim().length > LIMITS.messageMax;

  return (
    <div className="rounded-panel border-border bg-surface flex h-[min(46rem,calc(100dvh-11rem))] min-h-[30rem] flex-col overflow-hidden border shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]">
      <div className="border-border flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="liquid-primary grid size-9 shrink-0 place-items-center rounded-full">
            <Icon name="sparkle" size={16} />
          </span>
          <div className="min-w-0">
            <p className="text-small truncate font-semibold">
              Консультант по решениям
            </p>
            <p className="text-caption text-muted truncate">
              Демонстрационный помощник · не ИИ
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={reset}
            className="glass glass-hover text-caption rounded-control text-ink h-8 shrink-0 px-3 font-medium"
          >
            Начать заново
          </button>
        )}
      </div>

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Диалог с консультантом"
        className="flex-1 overflow-y-auto px-4 py-5 sm:px-6"
      >
        <ol className="grid gap-4">
          <Bubble role="assistant" text={WELCOME} />
          {messages.map((m) => (
            <li key={m.id} className="grid gap-3">
              <Bubble role={m.role} text={m.text} as="div" />
              {m.redacted && (
                <p className="text-caption text-muted pl-11">
                  Контакты из вашего сообщения скрыты и не переданы — для
                  подбора они не нужны.
                </p>
              )}
              {m.recommendations && m.recommendations.length > 0 && (
                <div className="grid gap-3 sm:pl-11 lg:grid-cols-2">
                  {m.recommendations.map((rec) => (
                    <RecommendationCard key={rec.solutionId} rec={rec} />
                  ))}
                </div>
              )}
            </li>
          ))}
          {pending && (
            <li
              className="flex items-center gap-3"
              aria-label="Консультант печатает"
            >
              <Avatar />
              <span className="bg-surface-2 rounded-field inline-flex gap-1 px-4 py-3">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    aria-hidden="true"
                    className="bg-muted size-1.5 animate-pulse rounded-full"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
                <span className="sr-only">Консультант печатает…</span>
              </span>
            </li>
          )}
        </ol>

        {error && (
          <div
            role="alert"
            className="rounded-card border-danger/40 bg-danger/10 mt-4 flex flex-wrap items-center justify-between gap-3 border p-4"
          >
            <p className="text-small text-danger">{error.message}</p>
            {error.retryable && (
              <button
                type="button"
                onClick={() => request(messages)}
                className="glass glass-hover text-small rounded-control text-ink h-9 px-4 font-medium"
              >
                Повторить
              </button>
            )}
          </div>
        )}

        {showQuickReplies && quickReplies.length > 0 && (
          <div className="mt-4 sm:pl-11">
            {messages.length === 0 && (
              <p className="text-caption text-muted mb-2">Например:</p>
            )}
            <ul className="flex flex-wrap gap-2" aria-label="Варианты ответа">
              {quickReplies.map((text) => (
                <li key={text}>
                  <button
                    type="button"
                    onClick={() => send(text)}
                    className="glass glass-hover text-small rounded-control text-ink min-h-9 px-4 py-1.5 text-left"
                  >
                    {text}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="border-border border-t p-3 sm:p-4">
        <label htmlFor="consultant-input" className="sr-only">
          Ваше сообщение
        </label>
        <div className="glass rounded-field flex items-end gap-2 p-1.5 pl-4">
          <textarea
            id="consultant-input"
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            maxLength={LIMITS.messageMax + 200}
            placeholder="Опишите задачу…"
            aria-describedby="consultant-hint"
            aria-invalid={tooLong || undefined}
            className="text-body text-ink placeholder:text-muted [field-sizing:content] max-h-36 min-h-10 w-0 flex-1 resize-none bg-transparent py-2 outline-none"
          />
          <button
            type="submit"
            disabled={pending || input.trim() === "" || tooLong}
            aria-label="Отправить сообщение"
            className="liquid-primary grid size-10 shrink-0 place-items-center rounded-full disabled:opacity-50"
          >
            <Icon name="arrow-right" size={18} />
          </button>
        </div>
        <p
          id="consultant-hint"
          className="text-caption text-muted mt-2 flex flex-wrap justify-between gap-x-4"
        >
          <span>
            Не указывайте имя, телефон и email — для подбора они не нужны.
          </span>
          <span className={cn(tooLong && "text-danger")}>
            {tooLong
              ? `Не длиннее ${LIMITS.messageMax} символов`
              : "Enter — отправить, Shift+Enter — новая строка"}
          </span>
        </p>
      </form>
    </div>
  );
}

function Avatar() {
  return (
    <span
      aria-hidden="true"
      className="glass text-accent grid size-8 shrink-0 place-items-center rounded-full"
    >
      <Icon name="sparkle" size={14} />
    </span>
  );
}

function Bubble({
  role,
  text,
  as: Tag = "li",
}: {
  role: "user" | "assistant";
  text: string;
  as?: "li" | "div";
}) {
  const isUser = role === "user";
  return (
    <Tag className={cn("flex gap-3", isUser && "justify-end")}>
      {!isUser && <Avatar />}
      <p
        className={cn(
          "text-small rounded-card max-w-[42rem] px-4 py-3 whitespace-pre-line",
          isUser
            ? "bg-accent-soft text-ink rounded-br-md"
            : "bg-surface-2 text-ink rounded-bl-md",
        )}
      >
        <span className="sr-only">{isUser ? "Вы: " : "Консультант: "}</span>
        {text}
      </p>
    </Tag>
  );
}
