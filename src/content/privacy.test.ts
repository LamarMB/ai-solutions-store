import { describe, expect, it } from "vitest";
import { privacyPolicyFromEnv } from "@/content/privacy";
import { requestStoreFromEnv } from "@/requests/store";

const operator = {
  PRIVACY_OPERATOR_NAME: "ИП Тестов Тест Тестович",
  PRIVACY_OPERATOR_INN: "771234567890",
  PRIVACY_OPERATOR_EMAIL: "privacy@example.ru",
};

describe("политика обработки персональных данных", () => {
  it("без данных оператора политики нет — приём заявок выключен", () => {
    expect(privacyPolicyFromEnv({})).toBeNull();
    for (const key of Object.keys(operator))
      expect(privacyPolicyFromEnv({ ...operator, [key]: "" }), key).toBeNull();
    const telegram = {
      REQUESTS_TELEGRAM_BOT_TOKEN: "1:x",
      REQUESTS_TELEGRAM_CHAT_ID: "1",
    };
    expect(
      requestStoreFromEnv(telegram, privacyPolicyFromEnv(telegram) !== null)
        .mode,
    ).toBe("test");
  });

  it("неверный ИНН или email — политики нет", () => {
    expect(
      privacyPolicyFromEnv({ ...operator, PRIVACY_OPERATOR_INN: "123" }),
    ).toBeNull();
    expect(
      privacyPolicyFromEnv({ ...operator, PRIVACY_OPERATOR_EMAIL: "нет" }),
    ).toBeNull();
  });

  it("текст: оператор, контакт, цель, основание, передача через Telegram, права", () => {
    const policy = privacyPolicyFromEnv(operator)!;
    expect(policy.operator).toBe("ИП Тестов Тест Тестович, ИНН 771234567890");
    const text = policy.sections.map((s) => s.text).join(" ");
    expect(text).toContain("privacy@example.ru");
    expect(text).toMatch(/Цель|Связаться с вами по заявке/);
    expect(text).toMatch(/согласие/i);
    expect(text).toMatch(/Telegram/);
    expect(text).toMatch(/за пределами Российской Федерации/);
    expect(text).toMatch(/отозвать согласие/);
  });
});
