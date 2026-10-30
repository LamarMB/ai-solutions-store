/**
 * Имитация ВКонтакте для сквозного сценария бота (scripts/e2e/bot-booking.mts).
 * Подменяет `fetch` у VkApi и цикла Bots Long Poll внутри процесса: отвечает на
 * groups.getLongPollServer, messages.send, messages.sendMessageEventAnswer и
 * запросы событий long poll. Любой другой адрес — ошибка: запрос в настоящий
 * ВКонтакте (или куда-либо ещё) из сценария невозможен.
 *
 * Пациент нажимает кнопки так же, как клиент ВКонтакте: callback-кнопка →
 * событие message_event с payload, текст — message_new.
 */

export const FAKE_VK_ORIGIN = "https://vk.e2e.invalid";
export const FAKE_VK_API = `${FAKE_VK_ORIGIN}/method`;
const LONG_POLL = `${FAKE_VK_ORIGIN}/longpoll`;
const KEY = "e2e-longpoll-key";

type VkButton = {
  action: { type: string; label: string; payload?: string };
};
export type SentMessage = {
  n: number;
  peerId: number;
  text: string;
  buttons: VkButton["action"][];
  at: string;
};
export type TranscriptEntry =
  | { from: "patient"; text: string; via: "text" | "button"; at: string }
  | { from: "bot"; text: string; buttons: string[]; at: string };

const CLIENT_INFO = {
  keyboard: true,
  inline_keyboard: true,
  button_actions: ["text", "callback", "open_link", "location"],
  lang_id: 0,
};

export class FakeVk {
  readonly sent: SentMessage[] = [];
  readonly transcript: TranscriptEntry[] = [];
  readonly calls: Record<string, number> = {};
  readonly blockedUrls: string[] = [];
  private readonly queue: object[] = [];
  private ts = 1;
  private messageId = 100;
  private eventN = 0;
  private wake?: () => void;
  private readonly waiters = new Set<() => void>();

  constructor(readonly groupId: number) {}

  /** Подставляется в VkApi и runLongPoll вместо глобального fetch. */
  readonly fetch: typeof fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(`${FAKE_VK_ORIGIN}/`)) {
      this.blockedUrls.push(new URL(url).origin);
      throw new Error(`E2E: запрос вне имитации ВКонтакте запрещён`);
    }
    if (url.startsWith(LONG_POLL)) return this.poll(url, init?.signal);
    const method = url.slice(FAKE_VK_API.length + 1);
    const params = new URLSearchParams(String(init?.body ?? ""));
    this.calls[method] = (this.calls[method] ?? 0) + 1;
    return Response.json({ response: this.method(method, params) });
  };

  private method(method: string, params: URLSearchParams): unknown {
    switch (method) {
      case "groups.getLongPollServer":
        return { server: LONG_POLL, key: KEY, ts: String(this.ts) };
      case "messages.send": {
        const keyboard = params.get("keyboard");
        const buttons = keyboard
          ? (JSON.parse(keyboard) as { buttons: VkButton[][] }).buttons
              .flat()
              .map((b) => b.action)
          : [];
        const message: SentMessage = {
          n: this.sent.length + 1,
          peerId: Number(params.get("peer_id")),
          text: params.get("message") ?? "",
          buttons,
          at: new Date().toISOString(),
        };
        this.sent.push(message);
        this.transcript.push({
          from: "bot",
          text: message.text,
          buttons: buttons.map((b) => b.label),
          at: message.at,
        });
        for (const notify of this.waiters) notify();
        return this.messageId++;
      }
      case "messages.sendMessageEventAnswer":
        return 1;
      default:
        throw new Error(`E2E: метод ${method} не имитируется`);
    }
  }

  private async poll(url: string, signal?: AbortSignal | null) {
    const query = new URL(url).searchParams;
    if (query.get("key") !== KEY) return Response.json({ failed: 2 });
    if (this.queue.length === 0)
      await new Promise<void>((done, fail) => {
        const timer = setTimeout(done, Number(query.get("wait") ?? 25) * 1000);
        this.wake = () => {
          clearTimeout(timer);
          done();
        };
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            fail(signal.reason);
          },
          { once: true },
        );
      });
    this.wake = undefined;
    const updates = this.queue.splice(0);
    if (updates.length > 0) this.ts += 1;
    return Response.json({ ts: String(this.ts), updates });
  }

  private push(update: object) {
    this.queue.push({ ...update, group_id: this.groupId });
    this.wake?.();
  }

  /** Сообщение пациента; payload — как у текстовой кнопки «Начать». */
  write(peerId: number, text: string, payload?: object) {
    this.transcript.push({
      from: "patient",
      text,
      via: payload ? "button" : "text",
      at: new Date().toISOString(),
    });
    this.push({
      type: "message_new",
      event_id: `e2e-${++this.eventN}`,
      object: {
        message: {
          id: ++this.messageId,
          date: Math.floor(Date.now() / 1000),
          from_id: peerId,
          peer_id: peerId,
          text,
          ...(payload ? { payload: JSON.stringify(payload) } : {}),
        },
        client_info: CLIENT_INFO,
      },
    });
  }

  /** Нажатие кнопки последнего сообщения бота с подписью `label`. */
  press(peerId: number, label: string | RegExp) {
    const last = this.sent.findLast(
      (m) => m.peerId === peerId && m.buttons.length > 0,
    );
    const button = last?.buttons.find((b) =>
      typeof label === "string" ? b.label === label : label.test(b.label),
    );
    if (!last || !button)
      throw new Error(
        `кнопки «${label}» нет; последние кнопки: ${last?.buttons.map((b) => b.label).join(" | ") ?? "нет"}`,
      );
    this.transcript.push({
      from: "patient",
      text: button.label,
      via: "button",
      at: new Date().toISOString(),
    });
    const n = ++this.eventN;
    if (button.type === "callback")
      this.push({
        type: "message_event",
        event_id: `e2e-${n}`,
        object: {
          user_id: peerId,
          peer_id: peerId,
          event_id: `e2e-callback-${n}`,
          payload: JSON.parse(button.payload ?? "{}"),
        },
      });
    else
      this.push({
        type: "message_new",
        event_id: `e2e-${n}`,
        object: {
          message: {
            id: ++this.messageId,
            date: Math.floor(Date.now() / 1000),
            from_id: peerId,
            peer_id: peerId,
            text: button.label,
            payload: button.payload,
          },
          client_info: CLIENT_INFO,
        },
      });
    return button;
  }

  /** Ждёт сообщения бота после `after`, текст которого подходит под `pattern`. */
  async reply(
    peerId: number,
    pattern: RegExp,
    after: number,
    timeoutMs = 10_000,
  ): Promise<SentMessage> {
    const find = () =>
      this.sent.find(
        (m) => m.n > after && m.peerId === peerId && pattern.test(m.text),
      );
    const deadline = Date.now() + timeoutMs;
    while (!find()) {
      if (Date.now() > deadline) {
        const got = this.sent
          .filter((m) => m.n > after)
          .map((m) => m.text.slice(0, 120));
        throw new Error(
          `бот не ответил по шаблону ${pattern} за ${timeoutMs} мс; получено: ${JSON.stringify(got)}`,
        );
      }
      await new Promise<void>((done) => {
        const notify = () => {
          this.waiters.delete(notify);
          done();
        };
        this.waiters.add(notify);
        setTimeout(notify, 200);
      });
    }
    return find()!;
  }

  get lastN() {
    return this.sent.length;
  }
}
