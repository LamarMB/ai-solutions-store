import { describe, expect, it } from "vitest";
import type { Button } from "@/bot/dialog/types";
import {
  capabilitiesFrom,
  FULL_CAPABILITIES,
  MINIAPP_BUTTON_LABEL,
  toVkKeyboard,
} from "@/bot/vk/keyboard";

const MINI_APP = { appId: 54834865, groupId: 242364009 };
const BOOK: Button = {
  label: "Записаться на приём",
  action: { a: "book" },
  color: "primary",
};
const MY: Button = { label: "Мои записи", action: { a: "my" } };
const MENU: Button = { label: "В меню", action: { a: "menu" } };
const ADMIN: Button = {
  label: "Позвать администратора",
  action: { a: "admin" },
};
const INFO: Button[] = [
  { label: "Цены", action: { a: "info", k: "prices" } },
  { label: "Врачи", action: { a: "info", k: "doctors" } },
  { label: "Адрес", action: { a: "info", k: "address" } },
];
const MAIN_MENU: Button[][] = [[BOOK, MY], INFO, [ADMIN]];

type VkButton = {
  action: Record<string, unknown> & { type: string; label: string };
  color?: string;
};
const parse = (json: string | undefined) =>
  JSON.parse(json!) as { inline?: boolean; buttons: VkButton[][] };

describe("клавиатура: кнопка VK Mini App", () => {
  it("в главном меню — отдельный ряд open_app под «Записаться на приём»", () => {
    const keyboard = parse(
      toVkKeyboard(MAIN_MENU, FULL_CAPABILITIES, MINI_APP),
    );
    expect(keyboard.buttons).toHaveLength(4);
    expect(keyboard.buttons[1]).toEqual([
      {
        action: {
          type: "open_app",
          app_id: 54834865,
          owner_id: -242364009,
          hash: "book",
          label: MINIAPP_BUTTON_LABEL,
        },
      },
    ]);
    // Остальные кнопки не изменились и идут в прежнем порядке.
    expect(keyboard.buttons[0].map((b) => b.action.label)).toEqual([
      "Записаться на приём",
      "Мои записи",
    ]);
    expect(keyboard.buttons[3][0].action.label).toBe("Позвать администратора");
    expect(MINIAPP_BUTTON_LABEL.length).toBeLessThanOrEqual(40);
  });

  it("без настроенного Mini App клавиатура прежняя", () => {
    expect(toVkKeyboard(MAIN_MENU, FULL_CAPABILITIES)).toBe(
      toVkKeyboard(MAIN_MENU, FULL_CAPABILITIES, undefined),
    );
    const keyboard = parse(toVkKeyboard(MAIN_MENU, FULL_CAPABILITIES));
    expect(
      keyboard.buttons.flat().some((b) => b.action.type === "open_app"),
    ).toBe(false);
  });

  it("кнопки нет там, где бот не предлагает записаться", () => {
    const keyboard = parse(
      toVkKeyboard([[MY, MENU]], FULL_CAPABILITIES, MINI_APP),
    );
    expect(
      keyboard.buttons.flat().some((b) => b.action.type === "open_app"),
    ).toBe(false);
  });

  it("клиент без open_app в button_actions — кнопки нет", () => {
    const caps = capabilitiesFrom({
      keyboard: true,
      inline_keyboard: true,
      button_actions: ["text", "callback"],
    });
    expect(caps.openApp).toBe(false);
    const keyboard = parse(toVkKeyboard(MAIN_MENU, caps, MINI_APP));
    expect(keyboard.buttons).toHaveLength(3);
  });

  it("клиент с open_app в button_actions — кнопка есть", () => {
    const caps = capabilitiesFrom({
      keyboard: true,
      inline_keyboard: true,
      button_actions: ["text", "callback", "open_app"],
    });
    expect(caps.openApp).toBe(true);
    const keyboard = parse(toVkKeyboard(MAIN_MENU, caps, MINI_APP));
    expect(keyboard.buttons[1][0].action.type).toBe("open_app");
  });

  it("inline-клавиатура не превышает 6 рядов и 10 кнопок", () => {
    const sixRows: Button[][] = [
      [BOOK],
      [MY],
      [MENU],
      [ADMIN],
      [INFO[0]],
      [INFO[1]],
    ];
    expect(
      parse(toVkKeyboard(sixRows, FULL_CAPABILITIES, MINI_APP)).buttons,
    ).toHaveLength(6);
    const tenButtons: Button[][] = [
      [BOOK, MY, MENU, ADMIN, INFO[0]],
      [INFO[1], INFO[2], MY, MENU, ADMIN],
    ];
    const keyboard = parse(
      toVkKeyboard(tenButtons, FULL_CAPABILITIES, MINI_APP),
    );
    expect(keyboard.buttons.flat()).toHaveLength(10);
  });

  it("обычная клавиатура (старые клиенты) тоже получает кнопку", () => {
    const caps = {
      keyboard: true,
      inline: false,
      callback: false,
      openApp: true,
    };
    const keyboard = parse(toVkKeyboard(MAIN_MENU, caps, MINI_APP));
    expect(keyboard.inline).toBeUndefined();
    expect(keyboard.buttons[1][0].action.type).toBe("open_app");
    expect(keyboard.buttons[0][0].action.type).toBe("text");
  });

  it("без поддержки клавиатур — ничего", () => {
    const caps = {
      keyboard: false,
      inline: false,
      callback: false,
      openApp: true,
    };
    expect(toVkKeyboard(MAIN_MENU, caps, MINI_APP)).toBeUndefined();
  });
});
