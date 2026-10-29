/**
 * VK-бот ИИ-администратора — Bots Long Poll. BOT_MODE=demo (по умолчанию) —
 * демонстрационная клиника, BOT_MODE=live — клиника-клиент.
 *
 *   npm run bot:vk
 *
 * Настройки — в .env.local (образец — .env.example). Остановка — Ctrl+C.
 */
import { createDemoBot } from "@/bot";
import { KeyedQueue, RateGate } from "@/bot/concurrency";
import { demoMarkers } from "@/bot/clinic/live-check";
import { createLogger, describeAccess, loadBotConfig } from "@/bot/config";
import { VkApi } from "@/bot/vk/api";
import { runLongPoll } from "@/bot/vk/longpoll";
import { createVkRunner, peerOf, VkAdminNotifier } from "@/bot/vk/runner";
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
  // Все вызовы VK API (ответы, уведомления, Long Poll) — в пределах лимита сообщества.
  gate: new RateGate(config.queue.vkPerSecond),
});
const notifier = config.vk.adminUserId
  ? new VkAdminNotifier(
      api,
      config.vk.groupId,
      config.vk.adminUserId,
      () => new Date(),
      config.mode === "demo",
    )
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
  miniApp: config.vk.miniAppId !== undefined,
  demo: config.mode === "demo",
  log,
});

// Клиника-клиент не должна получить ответы с данными вымышленной клиники,
// которые база получает при создании: сначала справочник заполняется в панели.
if (config.mode === "live") {
  const markers = demoMarkers(store.clinic.load());
  if (markers.length > 0) {
    log(
      "BOT_MODE=live, но в справочнике клиники остались данные демонстрационной клиники:",
    );
    for (const field of markers) log(`  ${field}`);
    log("Замените их в панели клиники и запустите бота снова.");
    store.close();
    process.exit(1);
  }
}
const runner = createVkRunner({
  api,
  bot,
  store,
  allowedUserIds: config.vk.allowedUserIds,
  demo: config.mode === "demo",
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
  // Истёкшие обращения к администратору: текст удаляется.
  const requests = store.requests.purgeExpired(new Date().toISOString());
  if (requests > 0) log(`истекло обращений к администратору: ${requests}`);
};
prune();
const pruneTimer = setInterval(prune, 3_600_000);

// Сообщения разных пациентов — параллельно, одного — строго по порядку.
const queue = new KeyedQueue<number>({
  concurrency: config.queue.concurrency,
  limit: config.queue.limit,
  onError: (error) =>
    log(`обработка события: ${error instanceof Error ? error.name : "error"}`),
});
/** Сколько ждать завершения очереди при остановке (systemd ждёт 90 с). */
const DRAIN_MS = 30_000;
// Позиция Long Poll, до которой события обработаны полностью: после
// перезапуска бот продолжит с неё и получит необработанные события снова.
const savedTs = store.getBotStatus().longpoll_ts?.value;

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log("остановка: новые события не принимаются, завершаю очередь…");
    controller.abort();
  });
}

log(
  `сообщество ${config.vk.groupId}, ${describeAccess(config)}, ` +
    `OpenAI: ${config.openai ? `да (${config.openai.model})` : "нет — работают кнопки и правила"}, ` +
    `администратор: ${notifier ? "уведомления включены" : "не задан"}, база: ${config.dbPath} (схема v${store.schemaVersion}), ` +
    `история разговора: ${config.historyHours} ч, ` +
    `шифрование и передача врачу: ${config.cipher ? "включены" : "выключены (нет MEDICAL_DATA_KEY)"}, ` +
    `вопросы о симптомах: ${config.medicalQuestions ? "да" : "нет"}, ` +
    `кнопка «Открыть приложение»: ${config.vk.miniAppId ? "да" : "нет (запись через бота)"}, ` +
    `обращения с согласием: ${config.cipher ? "да" : "нет (нет MEDICAL_DATA_KEY)"}, ` +
    `параллельно пациентов: ${config.queue.concurrency}, очередь до ${config.queue.limit}, ` +
    `VK API до ${config.queue.vkPerSecond}/с${config.openai ? `, OpenAI одновременно до ${config.openai.concurrency}` : ""}`,
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
      dispatch: (update) =>
        queue.push(peerOf(update), () => runner.onUpdate(update)),
      waitForCapacity: (signal) => queue.waitForCapacity(signal),
      initialTs: savedTs,
      onCommit: (ts) =>
        store.setBotStatus("longpoll_ts", ts, new Date().toISOString()),
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
  // Штатная остановка: доделываем принятые события, чтобы не потерять ответы.
  const drained = await queue.drain(DRAIN_MS);
  if (!drained)
    log(
      `за ${DRAIN_MS / 1000} с не завершены: выполнялось ${queue.running} (могут остаться без ответа), ` +
        `ждало ${queue.queued} (придут снова после запуска — позиция Long Poll сохранена до них)`,
    );
  store.setBotStatus(
    "stopped_at",
    new Date().toISOString(),
    new Date().toISOString(),
  );
  clearInterval(pruneTimer);
  store.close();
  log("бот остановлен");
}
