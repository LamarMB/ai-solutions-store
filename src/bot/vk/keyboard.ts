import type { Button } from "@/bot/dialog/types";

/** Кнопка VK Mini App клиники (тип open_app) — открывает приложение поверх чата. */
export type MiniAppButton = {
  appId: number;
  /** ID сообщества, в контексте которого открывается приложение (положительный). */
  groupId: number;
};

export const MINIAPP_BUTTON_LABEL = "📅 Записаться онлайн";
/** Ограничения inline-клавиатуры ВКонтакте: не больше 6 рядов и 10 кнопок. */
const INLINE_MAX_ROWS = 6;
const INLINE_MAX_BUTTONS = 10;

/** Что умеет клиент пользователя (client_info из события message_new). */
export type ClientCapabilities = {
  keyboard: boolean;
  inline: boolean;
  callback: boolean;
  /** Клиент умеет кнопки open_app (VK Mini Apps). */
  openApp: boolean;
};

export const FULL_CAPABILITIES: ClientCapabilities = {
  keyboard: true,
  inline: true,
  callback: true,
  openApp: true,
};

export function capabilitiesFrom(clientInfo: unknown): ClientCapabilities {
  if (!clientInfo || typeof clientInfo !== "object") return FULL_CAPABILITIES;
  const info = clientInfo as {
    keyboard?: boolean;
    inline_keyboard?: boolean;
    button_actions?: string[];
  };
  return {
    keyboard: info.keyboard !== false,
    inline: info.inline_keyboard !== false,
    callback: info.button_actions?.includes("callback") ?? true,
    openApp: info.button_actions?.includes("open_app") ?? false,
  };
}

/**
 * Клавиатура ВКонтакте из кнопок бота. Основной вариант — inline-клавиатура с
 * callback-кнопками (событие message_event); для старых клиентов — текстовые
 * кнопки, их payload приходит в message_new. Без поддержки клавиатур — undefined.
 */
export function toVkKeyboard(
  rows: Button[][],
  caps: ClientCapabilities,
  miniApp?: MiniAppButton,
): string | undefined {
  if (rows.length === 0 || !caps.keyboard) return undefined;
  const type = caps.callback && caps.inline ? "callback" : "text";
  const buttons: object[][] = rows.map((row) =>
    row.map((button) => ({
      action: {
        type,
        label: button.label,
        payload: JSON.stringify(button.action),
      },
      color: button.color ?? "secondary",
    })),
  );
  const at = miniAppRowIndex(rows, caps, miniApp);
  if (miniApp && at >= 0) {
    // Кнопка open_app занимает весь ряд — ставим её отдельным рядом
    // сразу под рядом с «Записаться на приём».
    buttons.splice(at + 1, 0, [
      {
        action: {
          type: "open_app",
          app_id: miniApp.appId,
          owner_id: -miniApp.groupId,
          hash: "book",
          label: MINIAPP_BUTTON_LABEL,
        },
      },
    ]);
  }
  return JSON.stringify({
    ...(caps.inline ? { inline: true } : { one_time: false }),
    buttons,
  });
}

/**
 * Ряд, после которого добавить кнопку Mini App, или -1. Кнопка появляется только
 * там, где бот предлагает записаться (действие «book»), если клиент её поддерживает
 * и в inline-клавиатуре остаётся место.
 */
function miniAppRowIndex(
  rows: Button[][],
  caps: ClientCapabilities,
  miniApp: MiniAppButton | undefined,
): number {
  if (!miniApp || !caps.openApp) return -1;
  const at = rows.findIndex((row) => row.some((b) => b.action.a === "book"));
  if (at < 0) return -1;
  if (caps.inline) {
    const total = rows.reduce((n, row) => n + row.length, 0);
    if (rows.length + 1 > INLINE_MAX_ROWS || total + 1 > INLINE_MAX_BUTTONS)
      return -1;
  }
  return at;
}
