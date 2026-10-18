/**
 * VK-бот ИИ-администратора (демонстрационный прототип) — Bots Long Poll.
 *
 *   npm run bot:vk
 *
 * Настройки — в .env.local (образец — .env.example). Остановка — Ctrl+C.
 */
import { createDemoBot } from "@/bot";
import { createLogger, loadBotConfig } from "@/bot/config";
import { VkApi } from "@/bot/vk/api";
import { runLongPoll } from "@/bot/vk/longpoll";
import { createVkRunner, VkAdminNotifier } from "@/bot/vk/runner";
import { loadLocalEnv } from "@/bot/env";

const log = createLogger("vk-bot");
loadLocalEnv();
const result = loadBotConfig(process.env);
if (!result.ok) {
  log("настройки не заданы или неверны:");
  for (const error of result.errors) log(`  ${error}`);
  log("Заполните .env.local по образцу .env.example и запустите снова.");
  process.exit(1);
}
const { config } = result;

const api = new VkApi({
  token: config.vk.token,
  version: config.vk.apiVersion,
});
const notifier = config.vk.adminUserId
  ? new VkAdminNotifier(api, config.vk.groupId, config.vk.adminUserId)
  : undefined;
const { bot, store } = createDemoBot({
  dbPath: config.dbPath,
  openai: config.openai,
  notifier,
  handoffHours: config.handoffHours,
  historyHours: config.historyHours,
  log,
});
const runner = createVkRunner({
  api,
  bot,
  store,
  allowedUserIds: config.vk.allowedUserIds,
  log,
});

// Отметки об обработанных событиях старше трёх суток больше не нужны;
// разговоры без активности дольше BOT_HISTORY_HOURS удаляются вместе с историей.
const prune = () => {
  store.pruneProcessedEvents(
    new Date(Date.now() - 3 * 86_400_000).toISOString(),
  );
  const removed = store.pruneSessions(
    new Date(Date.now() - config.historyHours * 3_600_000).toISOString(),
  );
  if (removed > 0) log(`удалено устаревших разговоров: ${removed}`);
};
prune();
const pruneTimer = setInterval(prune, 3_600_000);

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log("остановка…");
    controller.abort();
  });
}

log(
  `сообщество ${config.vk.groupId}, тестовых аккаунтов: ${config.vk.allowedUserIds.size}, ` +
    `OpenAI: ${config.openai ? `да (${config.openai.model})` : "нет — работают кнопки и правила"}, ` +
    `администратор: ${notifier ? "уведомления включены" : "не задан"}, база: ${config.dbPath} (схема v${store.schemaVersion}), ` +
    `история разговора: ${config.historyHours} ч`,
);

try {
  await runLongPoll(
    { api, groupId: config.vk.groupId, onUpdate: runner.onUpdate, log },
    controller.signal,
  );
} catch (error) {
  log(
    `остановлен из-за ошибки доступа: ${error instanceof Error ? error.message : "unknown"}. ` +
      "Проверьте ключ сообщества, его права и настройки Long Poll (npm run bot:check).",
  );
  process.exitCode = 1;
} finally {
  clearInterval(pruneTimer);
  store.close();
  log("бот остановлен");
}
