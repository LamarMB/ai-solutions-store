import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { emptyState, evaluate, type MonitorState } from "@/monitor/alerts";
import {
  checkClinic,
  checkServer,
  discoverClinics,
  type Finding,
  type Probes,
} from "@/monitor/checks";
import type { MonitorConfig } from "@/monitor/config";

/**
 * Один запуск мониторинга: клиники проверяются параллельно и независимо, затем
 * изменения сводятся в одно сообщение. Канал уведомлений — Telegram; журнал
 * (journalctl) получает то же без секретов в любом случае.
 */

export type Notifier = (text: string) => Promise<void>;
export type Log = (message: string) => void;

export class NotifyError extends Error {}

/** Telegram Bot API sendMessage. Токен — только в адресе запроса, в ошибки и журнал не попадает. */
export function telegramNotifier(
  telegram: NonNullable<MonitorConfig["telegram"]>,
  doFetch: typeof fetch = fetch,
): Notifier {
  return async (text) => {
    let response: Response;
    try {
      response = await doFetch(
        `${telegram.apiBase}/bot${telegram.token}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: telegram.chatId,
            text,
            disable_web_page_preview: true,
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch {
      throw new NotifyError("Telegram: нет связи");
    }
    if (!response.ok) {
      const description = (
        (await response.json().catch(() => ({}))) as { description?: string }
      ).description;
      throw new NotifyError(
        `Telegram: HTTP ${response.status}${description ? ` — ${description.replaceAll(telegram.token, "***").slice(0, 120)}` : ""}`,
      );
    }
  };
}

function loadState(path: string): MonitorState {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as MonitorState;
    return parsed && typeof parsed.alerts === "object" ? parsed : emptyState();
  } catch {
    return emptyState();
  }
}

function saveState(path: string, state: MonitorState) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const partial = `${path}.partial`;
  const fd = openSync(partial, "w", 0o600);
  try {
    writeSync(fd, `${JSON.stringify(state, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(partial, path);
}

export type RunResult = {
  findings: Finding[];
  /** Отправленный (или неотправленный) текст. */
  message?: string;
  notified: boolean;
};

export async function runMonitor(
  config: MonitorConfig,
  {
    probes,
    notify,
    now = new Date(),
    log = () => {},
  }: { probes: Probes; notify?: Notifier; now?: Date; log?: Log },
): Promise<RunResult> {
  const { clinics, findings } = discoverClinics(
    config.clinicsDir,
    probes.readText,
  );
  // Сбой проверки одной клиники не останавливает остальные.
  const perClinic = await Promise.allSettled(
    clinics.map((c) => checkClinic(c, config, probes, now)),
  );
  perClinic.forEach((r, i) => {
    if (r.status === "fulfilled") findings.push(...r.value);
    else
      findings.push({
        key: `${clinics[i].id}:monitor`,
        scope: clinics[i].id,
        title: "Мониторинг",
        problem: "проверки не выполнены",
      });
  });
  findings.push(...checkServer(config, probes));

  for (const f of findings)
    if (f.problem) log(`${f.scope} · ${f.title}: ${f.problem}`);
  log(
    `проверено: клиник ${clinics.length}, проверок ${findings.length}, проблем ${findings.filter((f) => f.problem).length}`,
  );

  const previous = loadState(config.stateFile);
  const { state, outbox } = evaluate(
    previous,
    findings,
    config,
    now,
    clinics.length,
  );
  let next = state;
  let notified = false;
  if (outbox.text) {
    if (!notify) {
      // Канал не настроен: журнал — единственный канал, та же защита от повторов.
      log(
        "уведомления не настроены (MONITOR_TELEGRAM_*): сообщение только в журнале",
      );
      log(outbox.text.replaceAll("\n", " | "));
      next = outbox.commit(state);
    } else {
      try {
        await notify(outbox.text);
        next = outbox.commit(state);
        notified = true;
        log("уведомление отправлено");
      } catch (error) {
        // Не помечаем отправленным: повтор при следующем запуске.
        log(
          `уведомление не отправлено: ${error instanceof NotifyError ? error.message : "ошибка"}; повтор при следующей проверке`,
        );
        log(outbox.text.replaceAll("\n", " | "));
        saveState(config.stateFile, next);
        throw error instanceof NotifyError
          ? error
          : new NotifyError("уведомление не отправлено");
      }
    }
  }
  saveState(config.stateFile, next);
  return { findings, message: outbox.text, notified };
}
