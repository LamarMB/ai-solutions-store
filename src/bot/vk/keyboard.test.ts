import { describe, expect, it } from "vitest";
import { fictionalClinic } from "@/bot/clinic/fictional-clinic";
import { show, type DialogContext } from "@/bot/dialog/dialog";
import { RuleInterpreter } from "@/bot/dialog/rule-interpreter";
import type { Button } from "@/bot/dialog/types";
import { ClinicSchedule } from "@/bot/schedule/schedule";
import { SqliteStore } from "@/bot/storage/sqlite";
import {
  APP_FALLBACK,
  capabilitiesFrom,
  FULL_CAPABILITIES,
  toVkKeyboard,
} from "@/bot/vk/keyboard";

const MINI_APP = { appId: 54834865, groupId: 242364009 };

type VkButton = {
  action: Record<string, unknown> & { type: string; label: string };
  color?: string;
};
const parse = (json: string | undefined) =>
  JSON.parse(json!) as { inline?: boolean; buttons: VkButton[][] };

function menu(appAvailable: boolean): Button[][] {
  const store = new SqliteStore(":memory:");
  const ctx: DialogContext = {
    peerId: 7,
    clinic: fictionalClinic,
    schedule: new ClinicSchedule(fictionalClinic, store),
    interpreter: new RuleInterpreter(fictionalClinic),
    today: "2026-10-19",
    appAvailable,
  };
  return show({ step: "menu" }, ctx).replies[0].buttons;
}

describe("главное меню: три действия", () => {
  it("«Открыть приложение» — отдельной кнопкой open_app, ниже «Мои записи» и «Администратор»", () => {
    const keyboard = parse(
      toVkKeyboard(menu(true), FULL_CAPABILITIES, MINI_APP),
    );
    expect(keyboard.inline).toBe(true);
    expect(keyboard.buttons).toHaveLength(2);
    expect(keyboard.buttons[0]).toEqual([
      {
        action: {
          type: "open_app",
          app_id: 54834865,
          owner_id: -242364009,
          label: "Открыть приложение",
        },
      },
    ]);
    expect(
      keyboard.buttons[1].map((b) => [b.action.type, b.action.label]),
    ).toEqual([
      ["callback", "Мои записи"],
      ["callback", "Администратор"],
    ]);
    // Ни одного повторяющегося действия и отдельной кнопки «Записаться онлайн».
    const labels = keyboard.buttons.flat().map((b) => b.action.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.join()).not.toMatch(/онлайн|Цены|Врачи|Адрес/);
    for (const b of keyboard.buttons.flat())
      expect(b.action.label.length).toBeLessThanOrEqual(40);
  });

  it("без Mini App главная кнопка — запись через бота", () => {
    const rows = menu(false);
    expect(rows[0][0].action).toEqual({ a: "book" });
    const keyboard = parse(toVkKeyboard(rows, FULL_CAPABILITIES));
    expect(keyboard.buttons[0][0].action.label).toBe("Записаться на приём");
    expect(keyboard.buttons[0][0].color).toBe("primary");
  });

  it("клиент без open_app: кнопка приложения заменяется записью через бота", () => {
    const caps = capabilitiesFrom({
      keyboard: true,
      inline_keyboard: true,
      button_actions: ["text", "callback"],
    });
    expect(caps.openApp).toBe(false);
    const keyboard = parse(toVkKeyboard(menu(true), caps, MINI_APP));
    expect(keyboard.buttons[0][0].action).toMatchObject({
      type: "callback",
      label: APP_FALLBACK.label,
      payload: JSON.stringify({ a: "book" }),
    });
    expect(
      keyboard.buttons.flat().some((b) => b.action.type === "open_app"),
    ).toBe(false);
  });

  it("клиент с open_app в button_actions — кнопка приложения настоящая", () => {
    const caps = capabilitiesFrom({
      keyboard: true,
      inline_keyboard: true,
      button_actions: ["text", "callback", "open_app"],
    });
    expect(caps.openApp).toBe(true);
    const keyboard = parse(toVkKeyboard(menu(true), caps, MINI_APP));
    expect(keyboard.buttons[0][0].action.type).toBe("open_app");
  });

  it("старые клиенты (текстовые кнопки) тоже получают open_app", () => {
    const caps = {
      keyboard: true,
      inline: false,
      callback: false,
      openApp: true,
    };
    const keyboard = parse(toVkKeyboard(menu(true), caps, MINI_APP));
    expect(keyboard.inline).toBeUndefined();
    expect(keyboard.buttons[0][0].action.type).toBe("open_app");
    expect(keyboard.buttons[1][0].action.type).toBe("text");
  });

  it("кнопки без действия «app» не превращаются в open_app", () => {
    const rows: Button[][] = [[{ label: "Мои записи", action: { a: "my" } }]];
    const keyboard = parse(toVkKeyboard(rows, FULL_CAPABILITIES, MINI_APP));
    expect(
      keyboard.buttons.flat().some((b) => b.action.type === "open_app"),
    ).toBe(false);
  });

  it("без поддержки клавиатур — ничего", () => {
    const caps = {
      keyboard: false,
      inline: false,
      callback: false,
      openApp: true,
    };
    expect(toVkKeyboard(menu(true), caps, MINI_APP)).toBeUndefined();
  });
});
