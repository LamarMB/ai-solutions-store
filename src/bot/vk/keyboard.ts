import type { Button } from "@/bot/dialog/types";

/** Что умеет клиент пользователя (client_info из события message_new). */
export type ClientCapabilities = {
  keyboard: boolean;
  inline: boolean;
  callback: boolean;
};

export const FULL_CAPABILITIES: ClientCapabilities = {
  keyboard: true,
  inline: true,
  callback: true,
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
): string | undefined {
  if (rows.length === 0 || !caps.keyboard) return undefined;
  const type = caps.callback && caps.inline ? "callback" : "text";
  return JSON.stringify({
    ...(caps.inline ? { inline: true } : { one_time: false }),
    buttons: rows.map((row) =>
      row.map((button) => ({
        action: {
          type,
          label: button.label,
          payload: JSON.stringify(button.action),
        },
        color: button.color ?? "secondary",
      })),
    ),
  });
}
