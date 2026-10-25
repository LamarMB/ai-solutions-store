import { describe, expect, it } from "vitest";
import { loadBotConfig } from "@/bot/config";

const TOKEN = "vk1.a.secret-token-value-123456";
const KEY = "sk-test-secret-openai-key-123456";

const base = {
  VK_GROUP_ID: "242364009",
  VK_GROUP_TOKEN: TOKEN,
  VK_ALLOWED_USER_IDS: "111, 222",
};

describe("настройки бота", () => {
  it("значения по умолчанию; без ключа OpenAI — только правила", () => {
    const result = loadBotConfig(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.vk.groupId).toBe(242364009);
    expect([...result.config.vk.allowedUserIds]).toEqual([111, 222]);
    expect(result.config.vk.apiVersion).toBe("5.199");
    expect(result.config.vk.adminUserId).toBeUndefined();
    expect(result.config.openai).toBeUndefined();
    expect(result.config.dbPath).toBe(".data/bot.sqlite");
    expect(result.config.handoffHours).toBe(12);
  });

  it("ключ OpenAI и необязательные поля", () => {
    const result = loadBotConfig({
      ...base,
      VK_ADMIN_USER_ID: "555",
      OPENAI_API_KEY: KEY,
      OPENAI_DAILY_REQUEST_LIMIT: "100",
    });
    expect(result.ok && result.config.openai).toEqual({
      apiKey: KEY,
      model: "gpt-5.6-luna",
      dailyLimit: 100,
    });
    expect(result.ok && result.config.vk.adminUserId).toBe(555);
  });

  it("пустые строки из .env считаются незаданными", () => {
    const result = loadBotConfig({
      ...base,
      VK_ADMIN_USER_ID: "",
      OPENAI_API_KEY: "",
    });
    expect(result.ok).toBe(true);
  });

  it("ошибки — по имени переменной, без значений секретов", () => {
    const result = loadBotConfig({
      VK_GROUP_ID: "abc",
      VK_GROUP_TOKEN: "short",
      VK_ALLOWED_USER_IDS: "111, иван",
      OPENAI_API_KEY: "sk-short",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const names = result.errors.map((e) => e.split(":")[0]);
    expect(names).toEqual(
      expect.arrayContaining([
        "VK_GROUP_ID",
        "VK_GROUP_TOKEN",
        "VK_ALLOWED_USER_IDS",
        "OPENAI_API_KEY",
      ]),
    );
    const text = result.errors.join("\n");
    expect(text).not.toContain("short");
    expect(text).not.toContain("иван");
  });

  it("список тестовых аккаунтов обязателен", () => {
    const result = loadBotConfig({ ...base, VK_ALLOWED_USER_IDS: "" });
    expect(result.ok).toBe(false);
  });
});
