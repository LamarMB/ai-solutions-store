/**
 * Первичная настройка бота на компьютере владельца:
 * - включает сообщения, возможности ботов и Long Poll в сообществе (если у ключа есть право
 *   «Управление сообществом»);
 * - определяет VK ID владельца по сообщению «тест» в сообщество и делает его тестовым
 *   аккаунтом и администратором;
 * - выбирает доступную недорогую модель OpenAI и проверяет её на вопросах о клинике.
 * Результат записывается в .env.local. Ключи не печатаются.
 *
 *   npm run bot:setup
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fictionalClinic } from "@/bot/clinic/fictional-clinic";
import { createLogger } from "@/bot/config";
import { RuleInterpreter } from "@/bot/dialog/rule-interpreter";
import type { Interpretation } from "@/bot/dialog/types";
import { upsertEnv } from "@/bot/env-file";
import { loadLocalEnv } from "@/bot/env";
import { MODEL_PREFERENCE, pickModels } from "@/bot/llm/models";
import { OpenAiInterpreter } from "@/bot/llm/openai-interpreter";
import { localDateTime } from "@/bot/schedule/time";
import { sleep, VkApi, VkApiError } from "@/bot/vk/api";

const ENV_PATH = ".env.local";
const log = createLogger("setup");
const ok = (m: string) => log(`OK   ${m}`);
const warn = (m: string) => log(`WARN ${m}`);
const fail = (m: string): never => {
  log(`FAIL ${m}`);
  process.exit(1);
};
const reason = (error: unknown) =>
  error instanceof VkApiError
    ? `код ${error.code}: ${error.message}`
    : error instanceof Error
      ? error.message
      : "неизвестная ошибка";

function save(values: Record<string, string>) {
  const text = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  writeFileSync(ENV_PATH, upsertEnv(text, values), "utf8");
  for (const key of Object.keys(values)) process.env[key] = values[key];
}

loadLocalEnv(ENV_PATH);
const groupId = Number(process.env.VK_GROUP_ID);
const token = process.env.VK_GROUP_TOKEN?.trim() ?? "";
if (!Number.isInteger(groupId) || groupId <= 0)
  fail("VK_GROUP_ID не задан в .env.local");
if (token.length < 20) fail("VK_GROUP_TOKEN не задан в .env.local");

const api = new VkApi({
  token,
  version: process.env.VK_API_VERSION || "5.199",
  retries: 2,
});

// 1. Ключ и сообщество.
try {
  const groups = await api.call<
    { groups?: { id: number; name: string }[] } | { id: number; name: string }[]
  >("groups.getById", { group_id: groupId });
  const group = (Array.isArray(groups) ? groups : (groups.groups ?? []))[0];
  if (group?.id !== groupId)
    fail(
      `ключ не относится к сообществу ${groupId} — создайте ключ в этом сообществе`,
    );
  ok(`ВКонтакте доступен, сообщество: ${group.name}`);
} catch (error) {
  fail(`ВКонтакте недоступен или ключ неверен (${reason(error)})`);
}

// 2. Сообщения, бот и Long Poll — включаем сами, если хватает прав.
try {
  await api.call("groups.setSettings", {
    group_id: groupId,
    messages: 1,
    bots_capabilities: 1,
    bots_start_button: 1,
    bots_add_to_chat: 0,
  });
  ok("сообщения сообщества, возможности ботов и кнопка «Начать» включены");
} catch (error) {
  warn(
    `не удалось включить сообщения и возможности ботов (${reason(error)}). ` +
      "Включите вручную: Управление → Сообщения → включить; Настройки для бота → Возможности ботов и кнопка «Начать».",
  );
}
try {
  await api.call("groups.setLongPollSettings", {
    group_id: groupId,
    enabled: 1,
    api_version: process.env.VK_API_VERSION || "5.199",
    message_new: 1,
    message_reply: 1,
    message_event: 1,
    message_allow: 1,
    message_deny: 1,
  });
  ok("Long Poll API включён: входящие, исходящие, нажатия кнопок");
} catch (error) {
  warn(
    `не удалось включить Long Poll (${reason(error)}). Включите вручную: Управление → Работа с API → ` +
      "Long Poll API → Включён, версия 5.199; Типы событий: входящее, исходящее сообщение, действие с сообщением.",
  );
}

// 3. VK ID владельца — по сообщению «тест» в сообщество.
type Conversations = {
  items: {
    conversation: { peer: { id: number; type: string } };
    last_message?: { from_id: number; text?: string; date: number };
  }[];
};
let ownerId = Number(process.env.VK_ALLOWED_USER_IDS?.split(/[,\s]+/)[0]);
if (Number.isInteger(ownerId) && ownerId > 0) {
  ok("тестовый аккаунт уже задан в VK_ALLOWED_USER_IDS");
} else {
  const started = Math.floor(Date.now() / 1000) - 120;
  log("");
  log(`>>> Откройте https://vk.com/club${groupId} со своего аккаунта, нажмите`);
  log(">>> «Написать сообщение» и отправьте слово:  тест");
  log(">>> Жду до 10 минут…");
  log("");
  const deadline = Date.now() + 10 * 60_000;
  ownerId = 0;
  while (!ownerId && Date.now() < deadline) {
    try {
      const result = await api.call<Conversations>(
        "messages.getConversations",
        {
          group_id: groupId,
          count: 20,
          filter: "all",
        },
      );
      const hit = result.items.find(
        (item) =>
          item.conversation.peer.type === "user" &&
          item.last_message &&
          item.last_message.from_id > 0 &&
          item.last_message.date >= started &&
          item.last_message.text?.trim().toLowerCase() === "тест",
      );
      if (hit) ownerId = hit.last_message!.from_id;
    } catch (error) {
      if (error instanceof VkApiError && [5, 15, 27].includes(error.code))
        fail(
          `нет доступа к сообщениям (${reason(error)}): у ключа должно быть право «Сообщения сообщества», а сообщения сообщества — включены`,
        );
      warn(`ошибка чтения диалогов (${reason(error)}), повторяю`);
    }
    if (!ownerId) await sleep(3000);
  }
  if (!ownerId)
    fail("сообщение «тест» не пришло за 10 минут — запустите настройку снова");
  const users = await api
    .call<{ first_name: string }[]>("users.get", { user_ids: ownerId })
    .catch(() => []);
  save({
    VK_ALLOWED_USER_IDS: String(ownerId),
    VK_ADMIN_USER_ID: String(ownerId),
  });
  ok(
    `ваш VK ID определён (${users[0]?.first_name ?? "аккаунт"}): записан тестовым аккаунтом и администратором`,
  );
}
if (!process.env.VK_ADMIN_USER_ID) save({ VK_ADMIN_USER_ID: String(ownerId) });

// 4. Модель OpenAI.
const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
if (apiKey.length < 20) {
  warn("OPENAI_API_KEY не задан — бот будет работать по кнопкам и правилам");
} else {
  let available: string[] = [];
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 401) fail("OpenAI: неверный ключ (401)");
    if (!response.ok)
      fail(`OpenAI: ответ ${response.status} при чтении моделей`);
    const body = (await response.json()) as { data?: { id: string }[] };
    available = (body.data ?? []).map((m) => m.id);
  } catch (error) {
    fail(`OpenAI недоступен (${reason(error)})`);
  }
  const candidates = pickModels(available);
  if (candidates.length === 0)
    fail(
      `ключу недоступна ни одна из моделей: ${MODEL_PREFERENCE.join(", ")}. Проверьте проект и оплату в OpenAI`,
    );

  const today = localDateTime(new Date(), fictionalClinic.timeZone).date;
  const questions = [
    "подскажите, сколько у вас стоит приём лора и где вы находитесь",
    "хочу записать ребёнка к педиатру на завтра",
    "какие у вас есть стоматологи?",
  ];
  let chosen = "";
  for (const model of candidates) {
    const errors: string[] = [];
    const interpreter = new OpenAiInterpreter(
      fictionalClinic,
      { apiKey, model, timeoutMs: 30_000, onError: (m) => errors.push(m) },
      new RuleInterpreter(fictionalClinic),
    );
    const results: Interpretation[] = [];
    for (const question of questions) {
      results.push(
        await interpreter.interpret(question, {
          peerId: 1,
          today,
          step: "menu",
        }),
      );
      if (errors.length) break;
    }
    if (errors.length) {
      warn(`модель ${model} не подошла: ${errors[0]}`);
      continue;
    }
    chosen = model;
    ok(`модель ${model} отвечает:`);
    questions.forEach((q, i) => {
      const r = results[i];
      log(
        `     «${q}» → ${r.intent}${r.specialtyId ? `, ${r.specialtyId}` : ""}${r.date ? `, ${r.date}` : ""}`,
      );
      if (r.answer)
        log(`       ответ: ${r.answer.replace(/\s+/g, " ").slice(0, 200)}`);
    });
    break;
  }
  if (!chosen)
    fail(
      "ни одна модель не ответила — бот может работать без OpenAI, удалите OPENAI_API_KEY",
    );
  save({ OPENAI_MODEL: chosen });
  ok(`OPENAI_MODEL=${chosen} записан в .env.local`);
}

log("настройка завершена: npm run bot:check, затем npm run bot:vk");
