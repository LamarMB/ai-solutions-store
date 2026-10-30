import { createHash } from "node:crypto";
import type { AdminNotifier, Bot } from "@/bot/bot";
import type { BotAccess } from "@/bot/config";
import type { BotEvent, Reply } from "@/bot/dialog/types";
import type { ChannelStore } from "@/bot/storage/types";
import { VkApiError, type VkApi } from "@/bot/vk/api";
import {
  capabilitiesFrom,
  FULL_CAPABILITIES,
  toVkKeyboard,
  type ClientCapabilities,
  type MiniAppButton,
} from "@/bot/vk/keyboard";
import type { VkUpdate } from "@/bot/vk/longpoll";

/** Лимит длины сообщения ВКонтакте с запасом. */
const MESSAGE_LIMIT = 4000;
/** Повторное уведомление постороннему пользователю — не чаще раза в сутки. */
const NOTICE_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** peer_id бесед начинаются с 2e9 — бот работает только в личных сообщениях. */
const CHAT_PEER_START = 2_000_000_000;
/**
 * Главное меню — постоянная клавиатура у поля ввода, а не кнопки под каждым
 * ответом. Повторно она отправляется по «Начать» и «В меню», при изменении кнопок
 * и раз в сутки (если пациент очистил историю или сменил устройство).
 */
const MENU_KEYBOARD_KIND = "menu_keyboard";
const MENU_KEYBOARD_REFRESH_MS = 24 * 60 * 60 * 1000;
const MENU_WORDS = /^\s*(?:меню|начать|start)\s*[.!]?\s*$/i;
/** Ошибки ВКонтакте о формате клавиатуры. */
const KEYBOARD_ERRORS = new Set([911, 912, 913]);

export const NOT_ALLOWED_TEXT =
  "Это демонстрационный бот тестовой клиники. Сейчас он доступен только тестовым аккаунтам.";
/** Бот клиники-клиента до открытия доступа (BOT_MODE=live со списком VK ID). */
export const NOT_YET_OPEN_TEXT =
  "Бот клиники пока проходит проверку и скоро заработает. Чтобы записаться сейчас, обратитесь в регистратуру клиники.";
export const ATTACHMENTS_TEXT =
  "Бот не принимает вложения. Пожалуйста, не отправляйте фото и медицинские документы — опишите вопрос текстом или выберите действие кнопкой.";
export const ERROR_TEXT =
  "Что-то пошло не так. Попробуйте ещё раз или напишите «меню».";

export type VkRunnerOptions = {
  api: VkApi;
  bot: Bot;
  store: ChannelStore;
  /** Кому отвечает бот: "all" — всем пациентам (BOT_MODE=live без списка). */
  allowedUserIds: BotAccess;
  /** false — клиника-клиент: ответ посторонним без слов «демонстрационный». По умолчанию true. */
  demo?: boolean;
  /** VK Mini App клиники: кнопка «Записаться онлайн» рядом с записью в боте. */
  miniApp?: MiniAppButton;
  now?: () => Date;
  log?: (message: string) => void;
};

/** Скрывает VK ID в логах: видны только последние цифры. */
export const maskId = (id: number) => `id…${String(id).slice(-3)}`;

/** random_id из ключа события: повторная отправка того же ответа отбрасывается ВКонтакте. */
export function randomIdFor(key: string): number {
  return createHash("sha256").update(key).digest().readUInt32BE(0) & 0x7fffffff;
}

/** Ключ события для защиты от повторной обработки. */
export function eventKey(update: VkUpdate): string | undefined {
  if (update.event_id) return `e:${update.event_id}`;
  const object = update.object ?? {};
  if (update.type === "message_event" && typeof object.event_id === "string")
    return `me:${object.event_id}`;
  const message = object.message as
    { id?: number; peer_id?: number } | undefined;
  if (update.type === "message_new" && message?.id)
    return `mn:${message.peer_id}:${message.id}`;
  return undefined;
}

/**
 * Пациент (peer_id), к которому относится событие, — ключ очереди: события
 * одного пациента обрабатываются строго по порядку. 0 — событие без пациента.
 */
export function peerOf(update: VkUpdate): number {
  const object = update.object ?? {};
  const message = object.message as { peer_id?: unknown } | undefined;
  const peer =
    update.type === "message_new" ? message?.peer_id : object.peer_id;
  return typeof peer === "number" && Number.isFinite(peer) ? peer : 0;
}

/** Длинный текст — на части не длиннее лимита, по возможности по границе строки. */
export function splitText(text: string): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > MESSAGE_LIMIT) {
    const newline = rest.lastIndexOf("\n", MESSAGE_LIMIT);
    const cut = newline > MESSAGE_LIMIT / 2 ? newline : MESSAGE_LIMIT;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(newline === cut ? cut + 1 : cut);
  }
  parts.push(rest);
  return parts;
}

/**
 * Обработка событий Bots Long Poll: проверка повторов и доступа, перевод в
 * события бота, отправка ответов. Текст сообщений в лог не пишется.
 */
export function createVkRunner(options: VkRunnerOptions) {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => {});
  const access = options.allowedUserIds;
  const allowed = (id: number) => access === "all" || access.has(id);
  const notAllowedText =
    options.demo === false ? NOT_YET_OPEN_TEXT : NOT_ALLOWED_TEXT;
  const { api, bot, store } = options;

  /**
   * Постоянная клавиатура главного меню, если её нужно (пере)отправить:
   * `kind` — отметка в notices с отпечатком клавиатуры (сменились кнопки — новая).
   */
  function menuKeyboard(
    peerId: number,
    reply: Reply,
    caps: ClientCapabilities,
    force: boolean,
  ): { keyboard: string; kind: string } | undefined {
    const keyboard = toVkKeyboard(reply.buttons, caps, options.miniApp, {
      persistent: true,
    });
    if (!keyboard) return undefined;
    const kind = `${MENU_KEYBOARD_KIND}:${createHash("sha256").update(keyboard).digest("hex").slice(0, 8)}`;
    const last = store.getNoticeAt(peerId, kind);
    const fresh =
      last && now().getTime() - Date.parse(last) < MENU_KEYBOARD_REFRESH_MS;
    return force || !fresh ? { keyboard, kind } : undefined;
  }

  async function send(
    peerId: number,
    replies: Reply[],
    caps: ClientCapabilities,
    key: string,
    forceMenu = false,
  ) {
    let index = 0;
    for (const reply of replies) {
      const parts = splitText(reply.text);
      // Главное меню у клиентов с inline-кнопками — без кнопок под сообщением.
      const persistent = reply.menu === true && caps.keyboard && caps.inline;
      const menu = persistent
        ? menuKeyboard(peerId, reply, caps, forceMenu)
        : undefined;
      for (let i = 0; i < parts.length; i++) {
        const last = i === parts.length - 1;
        const params = {
          peer_id: peerId,
          random_id: randomIdFor(`${key}:${index++}`),
          message: parts[i],
          keyboard: !last
            ? undefined
            : persistent
              ? menu?.keyboard
              : toVkKeyboard(reply.buttons, caps, options.miniApp),
          dont_parse_links: 1,
        };
        try {
          await api.call("messages.send", params);
        } catch (error) {
          // Клавиатуру с кнопкой Mini App ВКонтакте отклонил (911–913 — ошибки
          // формата клавиатуры): отправляем то же сообщение без неё.
          const plain =
            last && params.keyboard
              ? toVkKeyboard(reply.buttons, caps, undefined, { persistent })
              : params.keyboard;
          if (
            !(error instanceof VkApiError) ||
            !KEYBOARD_ERRORS.has(error.code) ||
            plain === params.keyboard
          )
            throw error;
          log(`open_app keyboard rejected: vk ${error.code}`);
          await api.call("messages.send", { ...params, keyboard: plain });
        }
        if (last && menu) {
          store.setNoticeAt(peerId, menu.kind, now().toISOString());
          forceMenu = false;
        }
      }
    }
  }

  async function noticeOnce(
    peerId: number,
    kind: string,
    text: string,
    key: string,
  ) {
    const last = store.getNoticeAt(peerId, kind);
    if (last && now().getTime() - Date.parse(last) < NOTICE_INTERVAL_MS) return;
    store.setNoticeAt(peerId, kind, now().toISOString());
    await send(peerId, [{ text, buttons: [] }], FULL_CAPABILITIES, key);
  }

  async function process(
    peerId: number,
    event: BotEvent,
    caps: ClientCapabilities,
    key: string,
  ) {
    try {
      const replies = await bot.handle(peerId, event);
      const forceMenu =
        event.type === "start" ||
        (event.type === "text" && MENU_WORDS.test(event.text)) ||
        (event.type === "action" &&
          (event.payload as { a?: unknown } | null)?.a === "menu");
      if (replies.length > 0) await send(peerId, replies, caps, key, forceMenu);
    } catch (error) {
      log(
        `handle failed for ${maskId(peerId)}: ${error instanceof VkApiError ? `vk ${error.code}` : error instanceof Error ? error.name : "error"}`,
      );
      if (!(error instanceof VkApiError)) {
        await send(
          peerId,
          [{ text: ERROR_TEXT, buttons: [] }],
          caps,
          `${key}:err`,
        ).catch(() => {});
      }
    }
  }

  return {
    async onUpdate(update: VkUpdate): Promise<void> {
      const key = eventKey(update);
      if (key && !store.markEventProcessed(key, now().toISOString())) {
        log(`duplicate ${update.type} skipped`);
        return;
      }
      const eventId = key ?? `${update.type}:${now().getTime()}`;
      const object = update.object ?? {};

      switch (update.type) {
        case "message_new": {
          const message = object.message as
            | {
                from_id: number;
                peer_id: number;
                text?: string;
                payload?: string;
                attachments?: unknown[];
              }
            | undefined;
          if (!message || message.from_id <= 0) return;
          if (
            message.peer_id !== message.from_id ||
            message.peer_id >= CHAT_PEER_START
          )
            return;
          const peerId = message.peer_id;
          if (!allowed(message.from_id)) {
            log(`message from not allowed ${maskId(peerId)}`);
            await noticeOnce(peerId, "not_allowed", notAllowedText, eventId);
            return;
          }
          const caps = capabilitiesFrom(object.client_info);
          if (message.attachments && message.attachments.length > 0) {
            await send(
              peerId,
              [{ text: ATTACHMENTS_TEXT, buttons: [] }],
              caps,
              eventId,
            );
            return;
          }
          let event: BotEvent = { type: "text", text: message.text ?? "" };
          if (message.payload) {
            try {
              const payload = JSON.parse(message.payload) as {
                command?: string;
              };
              event =
                payload?.command === "start"
                  ? { type: "start" }
                  : { type: "action", payload };
            } catch {
              // Неразборчивый payload — обрабатываем как текст.
            }
          }
          log(`message_new from ${maskId(peerId)}`);
          await process(peerId, event, caps, eventId);
          return;
        }

        case "message_event": {
          const { user_id, peer_id, event_id, payload } = object as {
            user_id: number;
            peer_id: number;
            event_id: string;
            payload?: unknown;
          };
          // Ответ на нажатие нужен всегда: иначе у кнопки крутится индикатор.
          await api
            .call("messages.sendMessageEventAnswer", {
              event_id,
              user_id,
              peer_id,
            })
            .catch((error: unknown) =>
              log(
                `event answer failed: ${error instanceof VkApiError ? error.code : "network"}`,
              ),
            );
          if (!allowed(user_id) || peer_id !== user_id) return;
          log(`message_event from ${maskId(peer_id)}`);
          await process(
            peer_id,
            { type: "action", payload },
            FULL_CAPABILITIES,
            eventId,
          );
          return;
        }

        case "message_reply": {
          // Сообщение, написанное администратором вручную, — бот замолкает в диалоге.
          const { peer_id, admin_author_id } = object as {
            peer_id?: number;
            admin_author_id?: number;
          };
          if (peer_id && admin_author_id && allowed(peer_id)) {
            bot.notePeerHandledByAdmin(peer_id);
            log(`admin replied to ${maskId(peer_id)}, bot paused`);
          }
          return;
        }

        default:
          return;
      }
    },
  };
}

/** Уведомление администратору в личные сообщения от имени сообщества. */
export class VkAdminNotifier implements AdminNotifier {
  constructor(
    private readonly api: VkApi,
    private readonly groupId: number,
    private readonly adminUserId: number,
    private readonly now: () => Date = () => new Date(),
    /** false — клиника-клиент: без пометки «демонстрационный бот». */
    private readonly demo: boolean = true,
  ) {}

  /** Только ссылка на диалог и номер обращения — без текста обращения и переписки. */
  async notifyHandoff(peerId: number, requestId?: number): Promise<void> {
    await this.api.call("messages.send", {
      peer_id: this.adminUserId,
      random_id: randomIdFor(
        `handoff:${peerId}:${requestId ?? 0}:${this.now().toISOString().slice(0, 16)}`,
      ),
      message:
        `Пациент просит администратора${this.demo ? " (демонстрационный бот)" : ""}. Откройте диалог в сообщениях сообщества: ` +
        `https://vk.com/gim${this.groupId}?sel=${peerId}` +
        (requestId
          ? `\nПациент разрешил передать текст обращения №${requestId} — он в панели клиники, раздел «Обращения».`
          : "\nТекст обращения через систему клиники не передавался."),
      dont_parse_links: 1,
    });
  }
}
