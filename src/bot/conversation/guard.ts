/**
 * Защита от спама и лишних расходов: частота сообщений, повторы одинакового
 * текста, слишком длинные сообщения. Хранит только время сообщений и хэш
 * текста в памяти процесса — сами тексты не сохраняются.
 */
import { createHash } from "node:crypto";

/** Длиннее — бот просит написать короче и не отправляет текст в модель. */
export const MAX_MESSAGE_CHARS = 1000;

export const TOO_LONG_TEXT =
  "Сообщение слишком длинное. Пожалуйста, опишите вопрос коротко — в одном-двух предложениях.";
export const RATE_LIMIT_TEXT =
  "Слишком много сообщений подряд. Пожалуйста, подождите минуту — потом я снова отвечу.";

/** Сколько раз подряд оффтоп получает шаблонный ответ, прежде чем бот замолчит. */
export const OFFTOPIC_REPLIES_BEFORE_MUTE = 3;
/** На сколько бот перестаёт отвечать на повторный оффтоп. */
export const OFFTOPIC_MUTE_MS = 10 * 60_000;

/** Ключи счётчиков: только количества, без текста и идентификаторов. */
export const STAT_KEYS = [
  /** Сообщения, переданные модели (попытки; лимиты клиента могут их не пропустить). */
  "model_requests",
  /** Сообщения, которые обработаны без модели благодаря фильтрам и защите. */
  "model_requests_saved",
  "offtopic_rejected",
  "role_change_rejected",
  /** Повторный оффтоп во время паузы — без ответа. */
  "offtopic_silenced",
  /** Модель сама отклонила посторонний запрос. */
  "model_out_of_scope",
  /** Приветствие или благодарность — ответ без модели. */
  "smalltalk_local",
  "too_long_rejected",
  "rate_limited",
  "spam_ignored",
] as const;
export type StatKey = (typeof STAT_KEYS)[number];

export type FloodVerdict =
  | "ok"
  /** Превышена частота: один раз сообщить, затем молчать до конца окна. */
  | "rate_limit_notice"
  | "rate_limited"
  /** Тот же текст снова и снова — без ответа. */
  | "spam";

export type FloodGuardOptions = {
  /** Сообщений в минуту от одного собеседника. */
  perMinute?: number;
  /** Сколько одинаковых сообщений подряд допускается за 2 минуты. */
  maxRepeats?: number;
  now?: () => Date;
};

const WINDOW_MS = 60_000;
const REPEAT_WINDOW_MS = 2 * 60_000;
/** Короткие ответы («да», «нет») законно повторяются в разных вопросах. */
const REPEAT_MIN_LENGTH = 12;

type PeerState = {
  times: number[];
  noticed: boolean;
  lastHash?: string;
  lastAt: number;
  repeats: number;
};

export class FloodGuard {
  private readonly peers = new Map<number, PeerState>();
  private readonly now: () => Date;

  constructor(private readonly options: FloodGuardOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  check(peerId: number, normalizedText: string): FloodVerdict {
    const t = this.now().getTime();
    const state = this.peers.get(peerId) ?? {
      times: [],
      noticed: false,
      lastAt: 0,
      repeats: 0,
    };
    this.peers.set(peerId, state);
    state.times = state.times.filter((at) => t - at < WINDOW_MS);
    state.times.push(t);
    if (state.times.length <= (this.options.perMinute ?? 12))
      state.noticed = false;

    const hash =
      normalizedText.length >= REPEAT_MIN_LENGTH
        ? createHash("sha256").update(normalizedText).digest("hex")
        : undefined;
    if (hash && hash === state.lastHash && t - state.lastAt < REPEAT_WINDOW_MS)
      state.repeats += 1;
    else state.repeats = 1;
    state.lastHash = hash;
    state.lastAt = t;

    if (state.times.length > (this.options.perMinute ?? 12)) {
      if (state.noticed) return "rate_limited";
      state.noticed = true;
      return "rate_limit_notice";
    }
    if (state.repeats > (this.options.maxRepeats ?? 2)) return "spam";
    this.prune(t);
    return "ok";
  }

  /** Забывает собеседников без сообщений дольше окна — память не растёт. */
  private prune(t: number) {
    if (this.peers.size < 1000) return;
    for (const [peer, state] of this.peers) {
      if (t - state.lastAt > REPEAT_WINDOW_MS) this.peers.delete(peer);
    }
  }
}
