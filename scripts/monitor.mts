/**
 * Мониторинг экземпляров клиник (docs/monitoring.md). Настройки — окружение
 * сервиса demo-med-monitor (файл /etc/demo-med/monitor.env). Токен Telegram и
 * другие секреты не печатаются.
 *
 *   run     проверки → тревоги → уведомление (сервис по таймеру)
 *   check   проверка настроек мониторинга
 *   test    тестовое сообщение в канал уведомлений
 *
 * Код выхода 1 — ошибка настроек или уведомление не отправлено (повтор — в
 * следующий запуск); проблемы клиник — не ошибка запуска, они в уведомлении.
 */
import { hostname } from "node:os";
import { systemProbes } from "@/monitor/checks";
import { loadMonitorConfig } from "@/monitor/config";
import { runMonitor, telegramNotifier } from "@/monitor/run";

const [command] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const log = (message: string) => console.log(`[monitor] ${message}`);

const loaded = loadMonitorConfig(process.env, hostname());
if (!loaded.ok) {
  for (const e of loaded.errors) log(`FAIL ${e}`);
  process.exit(1);
}
const { config } = loaded;
const notify = config.telegram ? telegramNotifier(config.telegram) : undefined;

switch (command) {
  case "check":
    log(
      `OK   настройки проверены; уведомления: ${notify ? "Telegram" : "не настроены — только журнал"}`,
    );
    break;
  case "test":
    if (!notify) {
      log(
        "FAIL уведомления не настроены (MONITOR_TELEGRAM_BOT_TOKEN, MONITOR_TELEGRAM_CHAT_ID)",
      );
      process.exit(1);
    }
    try {
      await notify(
        `Демо-Мед · ${config.serverName}\nℹ️ Тестовое сообщение мониторинга.`,
      );
      log("OK   тестовое сообщение отправлено");
    } catch (error) {
      log(`FAIL ${(error as Error).message}`);
      process.exit(1);
    }
    break;
  case "run":
    try {
      await runMonitor(config, { probes: systemProbes, notify, log });
    } catch {
      process.exit(1); // причина уже в журнале
    }
    break;
  default:
    log("команды: run, check, test");
    process.exit(1);
}
