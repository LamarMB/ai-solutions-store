import type { Clinic } from "@/bot/clinic/types";
import { handleEvent } from "@/bot/dialog/dialog";
import {
  DialogStateSchema,
  INITIAL_STATE,
  type BotEvent,
  type DialogState,
  type Reply,
  type TextInterpreter,
} from "@/bot/dialog/types";
import type { ScheduleProvider } from "@/bot/schedule/schedule";
import type { SessionStore } from "@/bot/storage/types";

/** Через сколько неактивности диалог начинается заново. */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export type BotDeps = {
  clinic: Clinic;
  schedule: ScheduleProvider;
  sessions: SessionStore;
  interpreter: TextInterpreter;
  now?: () => Date;
};

/**
 * Бот, независимый от канала: загружает состояние собеседника, обрабатывает
 * событие и сохраняет новое состояние. ВКонтакте, симулятор и тесты вызывают
 * один и тот же `handle`.
 */
export function createBot(deps: BotDeps) {
  const now = deps.now ?? (() => new Date());

  function loadState(peerId: number): DialogState {
    const saved = deps.sessions.load(peerId);
    if (!saved) return INITIAL_STATE;
    if (now().getTime() - Date.parse(saved.updatedAt) > SESSION_TTL_MS)
      return INITIAL_STATE;
    const parsed = DialogStateSchema.safeParse(saved.state);
    return parsed.success ? parsed.data : INITIAL_STATE;
  }

  return {
    async handle(peerId: number, event: BotEvent): Promise<Reply[]> {
      const { state, replies } = await handleEvent(loadState(peerId), event, {
        peerId,
        clinic: deps.clinic,
        schedule: deps.schedule,
        interpreter: deps.interpreter,
      });
      deps.sessions.save(peerId, state, now().toISOString());
      return replies;
    },
  };
}

export type Bot = ReturnType<typeof createBot>;
