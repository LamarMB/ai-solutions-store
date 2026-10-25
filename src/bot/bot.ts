import { resolveClinic, type ClinicSource } from "@/bot/clinic/types";
import {
  newSession,
  parseSession,
  serializeSession,
  type Session,
} from "@/bot/conversation/memory";
import {
  FloodGuard,
  RATE_LIMIT_TEXT,
  type StatKey,
} from "@/bot/conversation/guard";
import type { ConversationModel } from "@/bot/conversation/model";
import { handleTurn, REVOKE_RE } from "@/bot/conversation/orchestrator";
import { normalizeText } from "@/bot/dialog/rule-interpreter";
import type {
  BotEvent,
  ConsentPort,
  Reply,
  RequestPort,
  TextInterpreter,
} from "@/bot/dialog/types";
import { detectRedFlags, urgencyOf } from "@/bot/conversation/safety";
import type { ScheduleProvider } from "@/bot/schedule/schedule";
import { localDateTime } from "@/bot/schedule/time";
import type { SessionStore, StatsStore } from "@/bot/storage/types";

/** Через сколько часов неактивности разговор и его история забываются. */
export const DEFAULT_HISTORY_HOURS = 24;
/** Слова, которыми пациент возвращает бота после передачи администратору. */
const RESUME_WORDS = ["бот", "вернуться к боту", "/bot"];

/**
 * Уведомление администратора — реализует канал (ВКонтакте, позже другие).
 * Получает только id диалога: ни жалобы, ни текста сообщений в уведомление
 * не попадает.
 */
export interface AdminNotifier {
  /** requestId — номер обращения в панели (без его текста), если пациент разрешил передачу. */
  notifyHandoff(peerId: number, requestId?: number): Promise<void>;
}

export type BotDeps = {
  /** Данные клиники; функция читает актуальные данные из общей базы. */
  clinic: ClinicSource;
  schedule: ScheduleProvider;
  sessions: SessionStore;
  /** Правила — для работы без модели и при её ошибках. */
  interpreter: TextInterpreter;
  /** Разговорная модель (OpenAI); без неё — правила и кнопки. */
  model?: ConversationModel;
  notifier?: AdminNotifier;
  /** Срок хранения разговора без активности, часов. */
  historyHours?: number;
  /** Сколько текстовых сообщений в минуту принимается от одного собеседника. */
  messagesPerMinute?: number;
  /** Счётчики отклонённых запросов и обращений к модели (без текста). */
  stats?: StatsStore;
  /** Сколько часов бот молчит после передачи администратору. */
  handoffHours?: number;
  /** Согласия на передачу сведений врачу (нужен MEDICAL_DATA_KEY). */
  consents?: ConsentPort;
  /** false — без уточняющих вопросов о симптомах. */
  medicalQuestions?: boolean;
  /** Обращения к администратору с согласием (нужен MEDICAL_DATA_KEY). */
  requests?: RequestPort;
  /** Настроен VK Mini App: главная кнопка меню — «Открыть приложение». */
  appAvailable?: boolean;
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

  const historyMs = (deps.historyHours ?? DEFAULT_HISTORY_HOURS) * 3_600_000;
  const flood = new FloodGuard({ perMinute: deps.messagesPerMinute, now });

  function count(keys: readonly StatKey[]) {
    if (!deps.stats || keys.length === 0) return;
    const day = localDateTime(now(), resolveClinic(deps.clinic).timeZone).date;
    for (const key of keys) deps.stats.incrementStat(day, key);
  }

  function loadSession(peerId: number): Session {
    const saved = deps.sessions.load(peerId);
    if (!saved) return newSession();
    if (now().getTime() - Date.parse(saved.updatedAt) > historyMs)
      return newSession();
    return parseSession(saved.state);
  }

  function isPaused(peerId: number): boolean {
    const until = deps.sessions.getPausedUntil(peerId);
    return until !== undefined && Date.parse(until) > now().getTime();
  }

  /** Отзыв передачи работает и пока отвечает администратор (бот молчит). */
  function isRevoke(event: BotEvent): boolean {
    if (event.type === "action") {
      const payload = event.payload as { a?: unknown } | null;
      return payload?.a === "hrv";
    }
    return event.type === "text" && REVOKE_RE.test(normalizeText(event.text));
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
      let keepPaused = false;
      if (isPaused(peerId)) {
        // Отвечает администратор: бот молчит, пока пациент сам не вернёт его.
        // Исключение — отзыв передачи обращения: он не должен ждать.
        if (deps.requests && isRevoke(event)) keepPaused = true;
        else if (!wantsBotBack(event)) return [];
        else {
          deps.sessions.setPausedUntil(peerId, undefined);
          event = { type: "action", payload: { a: "bot" } };
        }
      }
      if (event.type === "text") {
        count(["messages_received"]);
        // Частота и повторы — до разговора и модели. Тревожные признаки
        // пропускаются всегда: на них бот отвечает даже при ограничении.
        const verdict = flood.check(peerId, normalizeText(event.text));
        if (
          verdict !== "ok" &&
          urgencyOf({ redFlags: detectRedFlags(event.text) }) !== "emergency"
        ) {
          count([
            verdict === "spam" ? "spam_ignored" : "rate_limited",
            ...(deps.model ? (["model_requests_saved"] as const) : []),
          ]);
          return verdict === "rate_limit_notice"
            ? [{ text: RATE_LIMIT_TEXT, buttons: [] }]
            : [];
        }
      }
      // Снимок данных клиники на время хода: изменения из панели — со следующего сообщения.
      const clinic = resolveClinic(deps.clinic);
      const { session, replies, effects, stats } = await handleTurn(
        loadSession(peerId),
        event,
        {
          peerId,
          clinic,
          schedule: deps.schedule,
          interpreter: deps.interpreter,
          model: deps.model,
          today: localDateTime(now(), clinic.timeZone).date,
          now: now(),
          consents: deps.consents,
          requests: deps.requests,
          appAvailable: deps.appAvailable,
          medicalQuestions: deps.medicalQuestions,
        },
      );
      count(stats);
      deps.sessions.save(
        peerId,
        // Во время паузы (отзыв передачи) шаг разговора не меняется.
        serializeSession(
          keepPaused
            ? { flow: loadSession(peerId).flow, conv: session.conv }
            : session,
        ),
        now().toISOString(),
      );

      for (const effect of effects) {
        if (effect.type === "handoff") {
          deps.sessions.setPausedUntil(
            peerId,
            new Date(now().getTime() + handoffMs).toISOString(),
          );
          try {
            await deps.notifier?.notifyHandoff(peerId, effect.requestId);
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

    /** Удаляет разговор собеседника (команда «сброс» делает то же из диалога). */
    forget(peerId: number): void {
      deps.sessions.delete(peerId);
    },
  };
}

export type Bot = ReturnType<typeof createBot>;
