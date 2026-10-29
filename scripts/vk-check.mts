/**
 * Проверка настроек перед запуском бота: переменные, доступ к ВКонтакте и
 * Long Poll, ключ OpenAI. Ничего не отправляет пользователям и не печатает секреты.
 *
 *   npm run bot:check
 */
import { createLogger, describeAccess, loadBotConfig } from "@/bot/config";
import { VkApi, VkApiError } from "@/bot/vk/api";
import { loadLocalEnv } from "@/bot/env";

const log = createLogger("check");
const ok = (m: string) => log(`OK   ${m}`);
const bad = (m: string) => {
  log(`FAIL ${m}`);
  process.exitCode = 1;
};

log(
  loadLocalEnv()
    ? ".env.local найден"
    : ".env.local не найден — читаю переменные окружения",
);
const result = loadBotConfig(process.env);
if (!result.ok) {
  for (const error of result.errors) bad(error);
  process.exit(1);
}
const { config } = result;
ok(`переменные заданы; ${describeAccess(config)}`);

const api = new VkApi({
  token: config.vk.token,
  version: config.vk.apiVersion,
  retries: 1,
});
const reason = (error: unknown) =>
  error instanceof VkApiError
    ? `код ${error.code}: ${error.message}`
    : error instanceof Error
      ? error.message
      : "неизвестная ошибка";

try {
  const groups = await api.call<
    { groups?: { id: number; name: string }[] } | { id: number; name: string }[]
  >("groups.getById", { group_id: config.vk.groupId });
  const list = Array.isArray(groups) ? groups : (groups.groups ?? []);
  const group = list[0];
  if (group?.id === config.vk.groupId) ok(`сообщество: ${group.name}`);
  else bad("ключ не относится к сообществу VK_GROUP_ID");
} catch (error) {
  bad(`ВКонтакте недоступен или ключ неверен (${reason(error)})`);
}

try {
  const settings = await api.call<{
    is_enabled?: boolean;
    api_version?: string;
    events?: Record<string, number>;
  }>("groups.getLongPollSettings", { group_id: config.vk.groupId });
  if (settings.is_enabled)
    ok(
      `Long Poll включён, версия API в настройках: ${settings.api_version ?? "?"}`,
    );
  else
    bad(
      "Long Poll выключен: Управление → Работа с API → Long Poll API → Включён",
    );
  for (const [event, name] of [
    ["message_new", "Входящее сообщение"],
    ["message_event", "Действие с сообщением"],
    ["message_reply", "Исходящее сообщение"],
  ] as const) {
    if (settings.events?.[event]) ok(`событие «${name}» включено`);
    else bad(`включите событие «${name}» (${event}) в настройках Long Poll`);
  }
} catch (error) {
  bad(
    `не удалось прочитать настройки Long Poll (${reason(error)}) — у ключа должно быть право «Управление сообществом» или проверьте вручную`,
  );
}

try {
  await api.call("groups.getLongPollServer", { group_id: config.vk.groupId });
  ok("сервер Long Poll выдан — бот сможет получать события");
} catch (error) {
  bad(`сервер Long Poll не выдан (${reason(error)})`);
}

if (config.openai) {
  try {
    const response = await fetch(
      `https://api.openai.com/v1/models/${encodeURIComponent(config.openai.model)}`,
      {
        headers: { Authorization: `Bearer ${config.openai.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (response.ok)
      ok(`OpenAI: ключ работает, модель ${config.openai.model} доступна`);
    else if (response.status === 401) bad("OpenAI: неверный ключ (401)");
    else if (response.status === 404)
      bad(
        `OpenAI: модель ${config.openai.model} недоступна (404) — задайте OPENAI_MODEL`,
      );
    else bad(`OpenAI: ответ ${response.status}`);
  } catch (error) {
    bad(`OpenAI недоступен (${reason(error)}); бот будет работать по кнопкам`);
  }
} else {
  log(
    "INFO OPENAI_API_KEY не задан — бот будет работать по кнопкам и ключевым словам",
  );
}
if (!config.vk.adminUserId) {
  log(
    "INFO VK_ADMIN_USER_ID не задан — запросы администратора не будут пересылаться",
  );
}
if (!config.cipher) {
  log(
    "INFO MEDICAL_DATA_KEY не задан — разговоры хранятся без шифрования, передача описания жалобы врачу выключена (docs/medical-privacy.md)",
  );
} else ok("MEDICAL_DATA_KEY: шифрование разговоров и согласий включено");
log(
  "INFO сообщения сообщества видят руководители сообщества ВКонтакте — панель это не ограничивает (docs/medical-privacy.md)",
);
log(
  process.exitCode
    ? "есть ошибки — исправьте и запустите проверку снова"
    : "всё готово: npm run bot:vk",
);
