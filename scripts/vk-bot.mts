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
  messagesPerMinute: config.messagesPerMinute,
  cipher: config.cipher,
  medicalQuestions: config.medicalQuestions,
  log,
});
const runner = createVkRunner({
  api,
  bot,
  store,
  allowedUserIds: config.vk.allowedUserIds,
  miniApp: config.vk.miniAppId
    ? { appId: config.vk.miniAppId, groupId: config.vk.groupId }
    : undefined,
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
  // Истёкшие согласия: статус expired, переданные врачу сведения удаляются.
  const expired = store.consents.purgeExpired(new Date().toISOString());
  if (expired > 0) log(`истекло согласий на передачу врачу: ${expired}`);
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
    `история разговора: ${config.historyHours} ч, ` +
    `шифрование и передача врачу: ${config.cipher ? "включены" : "выключены (нет MEDICAL_DATA_KEY)"}, ` +
    `вопросы о симптомах: ${config.medicalQuestions ? "да" : "нет"}, ` +
    `кнопка Mini App: ${config.vk.miniAppId ? "да" : "нет"}`,
);

try {
  store.setBotStatus(
    "started_at",
    new Date().toISOString(),
    new Date().toISOString(),
  );
  await runLongPoll(
    {
      api,
      groupId: config.vk.groupId,
      onUpdate: runner.onUpdate,
      log,
      // Отметка для админ-панели: бот получает события ВКонтакте.
      onPoll: () =>
        store.setBotStatus(
          "last_poll_at",
          new Date().toISOString(),
          new Date().toISOString(),
        ),
    },
    controller.signal,
  );
} catch (error) {
  log(
    `остановлен из-за ошибки доступа: ${error instanceof Error ? error.message : "unknown"}. ` +
      "Проверьте ключ сообщества, его права и настройки Long Poll (npm run bot:check).",
  );
  process.exitCode = 1;
} finally {
  store.setBotStatus(
    "stopped_at",
    new Date().toISOString(),
    new Date().toISOString(),
  );
  clearInterval(pruneTimer);
  store.close();
  log("бот остановлен");
}
