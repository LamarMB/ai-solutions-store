"use client";

import type { AccessLogEntry } from "@/bot/storage/consent-store";
import { useResource } from "@/components/admin/client";
import { formatMoment } from "@/components/admin/format";
import {
  EmptyState,
  ErrorNote,
  Loading,
  PageHeader,
  Panel,
} from "@/components/admin/ui";

type LogData = {
  consentsEnabled: boolean;
  activeConsents: number;
  entries: AccessLogEntry[];
};

const RESULTS: Record<string, string> = {
  granted: "открыто по согласию",
  denied_no_consent: "отказ: нет согласия",
  denied_not_own_booking: "отказ: не своя запись",
};

/** Журнал попыток открыть сведения: кто, когда, какая запись. Без содержания. */
export function AccessLog() {
  const { data, error, loading, reload } = useResource<LogData>("medical-log");
  return (
    <>
      <PageHeader
        title="Журнал доступа"
        description="Попытки врачей открыть сведения от пациентов. Содержание сведений здесь не показывается."
      />
      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : (
        data && (
          <div className="flex flex-col gap-4">
            <Panel>
              <p>
                Передача сведений врачу:{" "}
                {data.consentsEnabled
                  ? `включена, действующих согласий — ${data.activeConsents}`
                  : "выключена (на сервере не задан ключ шифрования)"}
                .
              </p>
            </Panel>
            {data.entries.length === 0 ? (
              <EmptyState title="Обращений к сведениям ещё не было" />
            ) : (
              <Panel>
                <ul className="divide-border flex flex-col divide-y">
                  {data.entries.map((e, i) => (
                    <li
                      key={i}
                      className="flex flex-wrap justify-between gap-2 py-2.5"
                    >
                      <span>
                        {formatMoment(e.at)} ·{" "}
                        {e.login ?? "удалённый сотрудник"} · запись №
                        {e.bookingId}
                      </span>
                      <span className="text-muted">
                        {RESULTS[e.result] ?? e.result}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        )
      )}
    </>
  );
}
