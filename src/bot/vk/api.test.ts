import { describe, expect, it, vi } from "vitest";
import { VkApi, VkApiError } from "@/bot/vk/api";
import {
  capabilitiesFrom,
  FULL_CAPABILITIES,
  toVkKeyboard,
} from "@/bot/vk/keyboard";

const TOKEN = "vk1.a.test-token-not-real-0000";

function apiWith(responses: unknown[]) {
  const requests: { url: string; body: URLSearchParams }[] = [];
  const fetch = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), body: init?.body as URLSearchParams });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return new Response(JSON.stringify(next));
    },
  );
  const sleep = vi.fn(async () => {});
  const api = new VkApi({
    token: TOKEN,
    version: "5.199",
    fetch: fetch as typeof globalThis.fetch,
    sleep,
  });
  return { api, requests, sleep };
}

describe("VkApi", () => {
  it("передаёт токен в теле запроса, а не в адресе", async () => {
    const { api, requests } = apiWith([{ response: 1 }]);
    await expect(
      api.call("messages.send", { peer_id: 1, message: "привет" }),
    ).resolves.toBe(1);
    expect(requests[0].url).toBe("https://api.vk.com/method/messages.send");
    expect(requests[0].url).not.toContain(TOKEN);
    expect(requests[0].body.get("access_token")).toBe(TOKEN);
    expect(requests[0].body.get("v")).toBe("5.199");
    expect(requests[0].body.get("message")).toBe("привет");
  });

  it("ошибка ВКонтакте — VkApiError без токена в сообщении", async () => {
    const { api } = apiWith([
      { error: { error_code: 5, error_msg: "User authorization failed" } },
    ]);
    const error = (await api
      .call("groups.getById", {})
      .catch((e: unknown) => e)) as VkApiError;
    expect(error).toBeInstanceOf(VkApiError);
    expect(error.code).toBe(5);
    expect(error.message).not.toContain(TOKEN);
  });

  it("повторяет временные ошибки и сетевые сбои, но не ошибки доступа", async () => {
    const retry = apiWith([
      { error: { error_code: 6, error_msg: "Too many requests" } },
      new TypeError("fetch failed"),
      { response: "ok" },
    ]);
    await expect(retry.api.call("messages.send", {})).resolves.toBe("ok");
    expect(retry.sleep).toHaveBeenCalledTimes(2);

    const fatal = apiWith([
      { error: { error_code: 15, error_msg: "Access denied" } },
    ]);
    await expect(fatal.api.call("messages.send", {})).rejects.toThrow(
      VkApiError,
    );
    expect(fatal.sleep).not.toHaveBeenCalled();
  });
});

describe("клавиатура ВКонтакте", () => {
  const rows = [
    [
      {
        label: "Записаться",
        action: { a: "book" as const },
        color: "primary" as const,
      },
    ],
    [{ label: "Мои записи", action: { a: "my" as const } }],
  ];

  it("по умолчанию — inline-клавиатура с callback-кнопками", () => {
    const keyboard = JSON.parse(toVkKeyboard(rows, FULL_CAPABILITIES)!);
    expect(keyboard.inline).toBe(true);
    expect(keyboard.buttons[0][0]).toEqual({
      action: {
        type: "callback",
        label: "Записаться",
        payload: '{"a":"book"}',
      },
      color: "primary",
    });
    expect(keyboard.buttons[1][0].color).toBe("secondary");
  });

  it("старые клиенты получают текстовые кнопки, без клавиатур — только текст", () => {
    const noCallback = capabilitiesFrom({
      keyboard: true,
      inline_keyboard: false,
      button_actions: ["text"],
    });
    const keyboard = JSON.parse(toVkKeyboard(rows, noCallback)!);
    expect(keyboard.inline).toBeUndefined();
    expect(keyboard.buttons[0][0].action.type).toBe("text");

    expect(toVkKeyboard(rows, capabilitiesFrom({ keyboard: false }))).toBe(
      undefined,
    );
    expect(toVkKeyboard([], FULL_CAPABILITIES)).toBeUndefined();
    expect(capabilitiesFrom(undefined)).toEqual(FULL_CAPABILITIES);
  });
});
