import type { Solution } from "@/catalog/schema";
import { redactContacts } from "@/consultant/privacy";
import {
  resolveRecommendations,
  type RecommendationView,
} from "@/consultant/recommendations";
import {
  ChatHistorySchema,
  type ChatProvider,
  type ChatTurn,
} from "@/consultant/types";
import type { RateLimiter } from "@/requests/rate-limit";

export type ConsultantResponse =
  | {
      status: "ok";
      text: string;
      recommendations: RecommendationView[];
      followUps: string[];
      /** В сообщении были контакты — они скрыты и не переданы провайдеру. */
      redacted: boolean;
    }
  | { status: "invalid"; message: string }
  | { status: "rate_limited"; message: string }
  | { status: "error"; message: string };

const PROVIDER_TIMEOUT_MS = 15_000;
const FOLLOW_UP_MAX = 4;

export type ConsultantDeps = {
  provider: ChatProvider;
  solutions: readonly Solution[];
  limiter: RateLimiter;
  clientKey: string;
};

/**
 * Обработка сообщения: проверка → частота → скрытие контактов → провайдер →
 * проверка рекомендаций по каталогу. Переписка нигде не сохраняется и не логируется.
 */
export async function handleConsultantMessage(
  history: unknown,
  deps: ConsultantDeps,
): Promise<ConsultantResponse> {
  const parsed = ChatHistorySchema.safeParse(history);
  if (!parsed.success) {
    return {
      status: "invalid",
      message: parsed.error.issues[0]?.message ?? "Некорректное сообщение.",
    };
  }
  if (!deps.limiter.attempt(deps.clientKey)) {
    return {
      status: "rate_limited",
      message:
        "Слишком много сообщений подряд. Подождите минуту и попробуйте снова.",
    };
  }

  let redacted = false;
  const turns: ChatTurn[] = parsed.data.map((turn) => {
    if (turn.role !== "user") return turn;
    const r = redactContacts(turn.text);
    if (r.redacted && turn === parsed.data.at(-1)) redacted = true;
    return { role: turn.role, text: r.text };
  });

  try {
    const reply = await withTimeout(
      deps.provider.reply(turns),
      PROVIDER_TIMEOUT_MS,
    );
    return {
      status: "ok",
      text: reply.text.trim().slice(0, 4000),
      recommendations: resolveRecommendations(
        reply.recommendations,
        deps.solutions,
      ),
      followUps: reply.followUps
        .map((f) => f.trim())
        .filter((f) => f.length > 0 && f.length <= 120)
        .slice(0, FOLLOW_UP_MAX),
      redacted,
    };
  } catch {
    return {
      status: "error",
      message: "Консультант сейчас не отвечает. Попробуйте ещё раз.",
    };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
