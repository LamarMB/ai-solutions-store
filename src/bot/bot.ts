import type { Clinic } from "@/bot/clinic/types";
import { handleEvent } from "@/bot/dialog/dialog";
import { normalizeText } from "@/bot/dialog/rule-interpreter";
import {
  DialogStateSchema,
  INITIAL_STATE,
  type BotEvent,
  type DialogState,
  type Reply,
  type TextInterpreter,
} from "@/bot/dialog/types";
import type { ScheduleProvider } from "@/bot/schedule/schedule";
import { localDateTime } from "@/bot/schedule/time";
import type { SessionStore } from "@/bot/storage/types";

/** Через сколько неактивности диалог начинается заново. */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
/** Слова, которыми пациент возвращает бота после передачи администратору. */
const RESUME_WORDS = ["бот", "вернуться к боту", "/bot"];

/** Уведомление администратора — реализует канал (ВКонтакте, позже другие). */
export interface AdminNotifier {
  notifyHandoff(peerId: number): Promise<void>;
}

export type BotDeps = {
  clinic: Clinic;
  schedule: ScheduleProvider;
  sessions: SessionStore;
  interpreter: TextInterpreter;
  notifier?: AdminNotifier;
  /** Сколько часов бот молчит после передачи администратору. */
  handoffHours?: number;
  now?: () => Date;
  /** Ошибки уведомлений — без персональных данных. */
  onError?: (message: string) => void;
};

/**
 * Бот, независимый от канала: загружает состояние собеседника, обрабатывает
 * событие и сохраняет новое состояние. ВКонтакте, симулятор и тесты вызывают
 * один и тот же `handle`.
 */
export function createBot(deps: BotDeps) {
  const now = deps.now ?? (() => new Date());
  const handoffMs = (deps.handoffHours ?? 12) * 60 * 60 * 1000;

  function loadState(peerId: number): DialogState {
    const saved = deps.sessions.load(peerId);
    if (!saved) return INITIAL_STATE;
    if (now().getTime() - Date.parse(saved.updatedAt) > SESSION_TTL_MS)
      return INITIAL_STATE;
    const parsed = DialogStateSchema.safeParse(saved.state);
    return parsed.success ? parsed.data : INITIAL_STATE;
  }

  function isPaused(peerId: number): boolean {
    const until = deps.sessions.getPausedUntil(peerId);
    return until !== undefined && Date.parse(until) > now().getTime();
  }

  function wantsBotBack(event: BotEvent): boolean {
    if (event.type === "action") {
      const payload = event.payload as { a?: unknown } | null;
      return payload?.a === "bot";
    }
    return (
      event.type === "text" && RESUME_WORDS.includes(normalizeText(event.text))
    );
  }

  return {
    async handle(peerId: number, event: BotEvent): Promise<Reply[]> {
      if (isPaused(peerId)) {
        // Отвечает администратор: бот молчит, пока пациент сам не вернёт его.
        if (!wantsBotBack(event)) return [];
        deps.sessions.setPausedUntil(peerId, undefined);
        event = { type: "action", payload: { a: "bot" } };
      }
      const { state, replies, effects } = await handleEvent(
        loadState(peerId),
        event,
        {
          peerId,
          clinic: deps.clinic,
          schedule: deps.schedule,
          interpreter: deps.interpreter,
          today: localDateTime(now(), deps.clinic.timeZone).date,
        },
      );
      deps.sessions.save(peerId, state, now().toISOString());

      for (const effect of effects ?? []) {
        if (effect.type === "handoff") {
          deps.sessions.setPausedUntil(
            peerId,
            new Date(now().getTime() + handoffMs).toISOString(),
          );
          try {
            await deps.notifier?.notifyHandoff(peerId);
          } catch {
            deps.onError?.("handoff notification failed");
          }
        }
      }
      return replies;
    },

    /** Администратор ответил вручную — продлеваем тишину бота в этом диалоге. */
    notePeerHandledByAdmin(peerId: number): void {
      deps.sessions.setPausedUntil(
        peerId,
        new Date(now().getTime() + handoffMs).toISOString(),
      );
    },

    isPaused,
  };
}

export type Bot = ReturnType<typeof createBot>;
