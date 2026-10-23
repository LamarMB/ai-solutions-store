import type { Button } from "@/bot/dialog/types";

/** VK Mini App клиники для кнопки open_app — открывает приложение поверх чата. */
export type MiniAppButton = {
  appId: number;
  /** ID сообщества, в контексте которого открывается приложение (положительный). */
  groupId: number;
};

/**
 * Замена кнопки приложения, если open_app недоступна (приложение не настроено
 * или клиент не умеет такие кнопки): запись через бота.
 */
export const APP_FALLBACK: Button = {
  label: "Записаться на приём",
  action: { a: "book" },
  color: "primary",
};

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
 *
 * Кнопка приложения (действие «app») становится кнопкой ВКонтакте open_app,
 * открывающей VK Mini App в контексте сообщества. У open_app нет цвета и
 * подписи под названием: пояснение — в тексте сообщения над кнопками.
 */
export function toVkKeyboard(
  rows: Button[][],
  caps: ClientCapabilities,
  miniApp?: MiniAppButton,
): string | undefined {
  if (rows.length === 0 || !caps.keyboard) return undefined;
  const type = caps.callback && caps.inline ? "callback" : "text";
  const openApp = miniApp && caps.openApp ? miniApp : undefined;
  const buttons: object[][] = rows.map((row) =>
    row.map((original) => {
      if (original.action.a === "app" && openApp)
        return {
          action: {
            type: "open_app",
            app_id: openApp.appId,
            owner_id: -openApp.groupId,
            label: original.label,
          },
        };
      const button =
        original.action.a === "app"
          ? { ...APP_FALLBACK, color: original.color }
          : original;
      return {
        action: {
          type,
          label: button.label,
          payload: JSON.stringify(button.action),
        },
        color: button.color ?? "secondary",
      };
    }),
  );
  return JSON.stringify({
    ...(caps.inline ? { inline: true } : { one_time: false }),
    buttons,
  });
}
