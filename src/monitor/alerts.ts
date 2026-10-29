import type { Finding } from "@/monitor/checks";
import type { MonitorConfig } from "@/monitor/config";

/**
 * Состояние тревог между запусками (state.json) и защита от спама:
 * - тревога — только после `failAfter` неудачных проверок подряд;
 * - пока проблема не исправлена, повторов нет; напоминание — раз в `remindHours`;
 * - исправилось — одно сообщение «восстановлено» с длительностью;
 * - все изменения одного запуска — одним сообщением;
 * - сообщение не ушло — ничего не помечается отправленным, повтор в следующий раз.
 */

export type AlertEntry = {
  scope: string;
  title: string;
  problem: string;
  /** Неудачных проверок подряд. */
  failures: number;
  /** Когда проблема впервые замечена (ISO). */
  since: string;
  /** Тревога отправлена. */
  alerted: boolean;
  lastNotified?: string;
  /** Исправилось — ждёт отправки «восстановлено». */
  recovered?: string;
};

export type MonitorState = {
  alerts: Record<string, AlertEntry>;
  /** Дата последней ежедневной сводки (ГГГГ-ММ-ДД). */
  lastDaily?: string;
};

export const emptyState = (): MonitorState => ({ alerts: {} });

export type Outbox = {
  text?: string;
  /** Что пометить после успешной отправки. */
  commit: (state: MonitorState) => MonitorState;
};

const MAX_MESSAGE = 3900;

const duration = (fromIso: string, to: Date) => {
  const min = Math.max(
    0,
    Math.round((to.getTime() - Date.parse(fromIso)) / 60_000),
  );
  return min < 120 ? `${min} мин` : `${Math.round(min / 60)} ч`;
};
const line = (e: { scope: string; title: string }, rest: string) =>
  `• ${e.scope === "server" ? "сервер" : e.scope} — ${e.title}: ${rest}`;

export function evaluate(
  previous: MonitorState,
  findings: readonly Finding[],
  config: Pick<
    MonitorConfig,
    "failAfter" | "remindHours" | "dailyReportHour" | "serverName"
  >,
  now: Date,
  clinicCount: number,
): { state: MonitorState; outbox: Outbox } {
  const at = now.toISOString();
  const alerts: Record<string, AlertEntry> = structuredClone(previous.alerts);
  const seen = new Set<string>();

  for (const f of findings) {
    seen.add(f.key);
    const entry = alerts[f.key];
    if (f.problem) {
      if (!entry || entry.recovered) {
        // Новая проблема (или вернулась до отправки «восстановлено»).
        alerts[f.key] = entry?.recovered
          ? {
              ...entry,
              problem: f.problem,
              failures: entry.failures + 1,
              recovered: undefined,
            }
          : {
              scope: f.scope,
              title: f.title,
              problem: f.problem,
              failures: 1,
              since: at,
              alerted: false,
            };
      } else {
        alerts[f.key] = {
          ...entry,
          problem: f.problem,
          failures: entry.failures + 1,
        };
      }
    } else if (entry) {
      if (entry.alerted)
        alerts[f.key] = { ...entry, recovered: entry.recovered ?? at };
      else delete alerts[f.key]; // не успело стать тревогой — молча
    }
  }
  // Проверка больше не выполняется (клиника удалена, сервис выключен) — как «исправилось».
  for (const [key, entry] of Object.entries(alerts))
    if (!seen.has(key)) {
      if (entry.alerted)
        alerts[key] = { ...entry, recovered: entry.recovered ?? at };
      else delete alerts[key];
    }

  const fresh: string[] = [];
  const reminders: string[] = [];
  const recovered: string[] = [];
  for (const [key, e] of Object.entries(alerts)) {
    if (e.recovered) recovered.push(key);
    else if (!e.alerted && e.failures >= config.failAfter) fresh.push(key);
    else if (
      e.alerted &&
      config.remindHours > 0 &&
      now.getTime() - Date.parse(e.lastNotified ?? e.since) >=
        config.remindHours * 3_600_000
    )
      reminders.push(key);
  }

  const today = at.slice(0, 10);
  const daily =
    config.dailyReportHour >= 0 &&
    now.getHours() >= config.dailyReportHour &&
    previous.lastDaily !== today;

  const parts: string[] = [];
  if (fresh.length > 0)
    parts.push(
      `🔴 Проблемы (${fresh.length}):`,
      ...fresh.map((k) => line(alerts[k], alerts[k].problem)),
    );
  if (reminders.length > 0)
    parts.push(
      `🟠 Не исправлено (${reminders.length}):`,
      ...reminders.map((k) =>
        line(
          alerts[k],
          `${alerts[k].problem} (уже ${duration(alerts[k].since, now)})`,
        ),
      ),
    );
  if (recovered.length > 0)
    parts.push(
      `✅ Восстановлено (${recovered.length}):`,
      ...recovered.map((k) =>
        line(
          alerts[k],
          `работает (сбой длился ${duration(alerts[k].since, new Date(alerts[k].recovered!))})`,
        ),
      ),
    );
  if (daily) {
    const open = Object.values(alerts).filter(
      (e) => !e.recovered && e.alerted,
    ).length;
    parts.push(
      `ℹ️ Ежедневная сводка: клиник ${clinicCount}, открытых проблем ${open}. Мониторинг работает.`,
    );
  }

  let text: string | undefined;
  if (parts.length > 0) {
    text = [`Демо-Мед · ${config.serverName}`, ...parts].join("\n");
    if (text.length > MAX_MESSAGE) {
      const lines = text.split("\n");
      let cut = "";
      let i = 0;
      while (
        i < lines.length &&
        cut.length + lines[i].length + 1 < MAX_MESSAGE - 60
      )
        cut += `${lines[i++]}\n`;
      text = `${cut}…и ещё строк: ${lines.length - i}. Подробно — journalctl -u demo-med-monitor`;
    }
  }

  const state: MonitorState = { ...previous, alerts };
  return {
    state,
    outbox: {
      text,
      commit: (s) => {
        const next: MonitorState = { ...s, alerts: { ...s.alerts } };
        for (const k of [...fresh, ...reminders])
          next.alerts[k] = {
            ...next.alerts[k],
            alerted: true,
            lastNotified: at,
          };
        for (const k of recovered) delete next.alerts[k];
        if (daily) next.lastDaily = today;
        return next;
      },
    },
  };
}
