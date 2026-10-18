import { describe, expect, it } from "vitest";
import { upsertEnv } from "@/bot/env-file";
import { pickModels } from "@/bot/llm/models";
import { reasoningOptions } from "@/bot/llm/openai-client";

describe("настройка бота", () => {
  it("upsertEnv меняет значения и сохраняет комментарии", () => {
    const text = "# комментарий\r\nVK_GROUP_ID=1\r\nVK_GROUP_TOKEN=\r\n\r\n";
    expect(
      upsertEnv(text, { VK_GROUP_TOKEN: "abc", VK_ALLOWED_USER_IDS: "7" }),
    ).toBe(
      "# комментарий\nVK_GROUP_ID=1\nVK_GROUP_TOKEN=abc\nVK_ALLOWED_USER_IDS=7\n",
    );
    // Закомментированная переменная не заменяется, а добавляется заново.
    expect(upsertEnv("# OPENAI_MODEL=x\n", { OPENAI_MODEL: "y" })).toBe(
      "# OPENAI_MODEL=x\nOPENAI_MODEL=y\n",
    );
  });

  it("выбирает доступные модели в порядке предпочтения", () => {
    expect(pickModels(["gpt-4o-mini", "gpt-5-mini", "whisper-1"])).toEqual([
      "gpt-5-mini",
      "gpt-4o-mini",
    ]);
    expect(pickModels([])).toEqual([]);
  });

  it("низкий уровень рассуждений только для рассуждающих моделей", () => {
    expect(reasoningOptions("gpt-5-mini")).toEqual({
      reasoning: { effort: "low" },
    });
    expect(reasoningOptions("gpt-4.1-mini")).toEqual({});
  });
});
