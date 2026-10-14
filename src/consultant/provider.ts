import { getIndustries, getSolutions } from "@/catalog";
import { MockChatProvider } from "@/consultant/mock-provider";
import type { ChatProvider } from "@/consultant/types";

let provider: ChatProvider | undefined;

/**
 * Текущий провайдер консультанта. Сейчас — только демонстрационный mock;
 * подключение LLM описано в docs/consultant.md и включается отдельным решением.
 */
export function getChatProvider(): ChatProvider {
  provider ??= new MockChatProvider(getSolutions(), getIndustries());
  return provider;
}
