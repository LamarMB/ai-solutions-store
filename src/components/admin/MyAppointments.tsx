"use client";

import { useState } from "react";
import type { BookingView } from "@/admin/service";
import { api, ApiError, useResource } from "@/components/admin/client";
import { formatDate, shiftDate } from "@/components/admin/format";
import {
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Panel,
  StatusBadge,
} from "@/components/admin/ui";
import { Button } from "@/components/ui/Button";

type MyBooking = BookingView & { medicalShared: boolean };
type MyData = {
  doctorName: string;
  consentsEnabled: boolean;
  bookings: MyBooking[];
};
type Medical = {
  bookingId: number;
  source: string;
  area: string;
  summary: string;
  trauma: "yes" | "no" | null;
  duration: string | null;
  redFlags: string[];
  redFlagsDenied: boolean;
};

/**
 * Приёмы врача: только записи к своему врачу расписания. Сведения о жалобе
 * открываются по отдельному запросу и только если пациент сам разрешил
 * передать их врачу этой записи; каждое открытие — в журнале доступа.
 */
export function MyAppointments({ today }: { today: string }) {
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(shiftDate(today, 14));
  const { data, error, loading, reload } = useResource<MyData>(
    `my/bookings?from=${from}&to=${to}`,
  );
  const [opened, setOpened] = useState<Medical>();
  const [openError, setOpenError] = useState<string>();
  const [busy, setBusy] = useState<number>();

  async function openMedical(id: number) {
    setBusy(id);
    setOpenError(undefined);
    try {
      setOpened(await api<Medical>(`my/${id}/medical`));
    } catch (e) {
      setOpenError(
        e instanceof ApiError ? e.message : "Не удалось открыть сведения.",
      );
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <>
      <PageHeader
        title="Мои приёмы"
        description={
          data
            ? `${data.doctorName}. Только ваши записи; переписку пациентов панель не показывает.`
            : undefined
        }
      />
      <Panel className="mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="С">
            {(props) => (
              <Input
                {...props}
                narrow
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            )}
          </Field>
          <Field label="По">
            {(props) => (
              <Input
                {...props}
                narrow
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            )}
          </Field>
        </div>
        {data && !data.consentsEnabled && (
          <p className="text-small text-muted mt-4">
            Передача сведений от пациентов выключена на сервере (нет ключа
            шифрования). Видны только время и статус записей.
          </p>
        )}
      </Panel>
      {error && <ErrorNote message={error} onRetry={reload} />}
      {openError && <ErrorNote message={openError} />}
      {loading && !data ? (
        <Loading />
      ) : data && data.bookings.length === 0 ? (
        <EmptyState title="Записей за эти дни нет" />
      ) : (
        <ul className="flex flex-col gap-2">
          {data?.bookings.map((b) => (
            <li
              key={b.id}
              className="border-border bg-surface rounded-card flex flex-wrap items-center justify-between gap-3 border px-4 py-3"
            >
              <div>
                <p className="font-medium">
                  {formatDate(b.date)}, {b.time} · №{b.id}
                </p>
                <p className="text-small text-muted">{b.patient}</p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={b.status} />
                {b.medicalShared ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === b.id}
                    onClick={() => openMedical(b.id)}
                  >
                    {busy === b.id ? "Открываю…" : "Сведения от пациента"}
                  </Button>
                ) : (
                  <span className="text-caption text-muted">сведений нет</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={opened !== undefined}
        title={opened ? `Сведения по записи №${opened.bookingId}` : ""}
        onClose={() => setOpened(undefined)}
      >
        {opened && (
          <div className="flex flex-col gap-4">
            <p className="text-small border-border bg-surface-2 rounded-field border px-3 py-2">
              {opened.source}
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <dt className="text-muted">Область</dt>
              <dd>{opened.area}</dd>
              <dt className="text-muted">Со слов</dt>
              <dd>«{opened.summary}»</dd>
              {opened.trauma && (
                <>
                  <dt className="text-muted">Травма</dt>
                  <dd>{opened.trauma === "yes" ? "была" : "не было"}</dd>
                </>
              )}
              {opened.duration && (
                <>
                  <dt className="text-muted">Как давно</dt>
                  <dd>{opened.duration}</dd>
                </>
              )}
              <dt className="text-muted">Тревожные признаки</dt>
              <dd>
                {opened.redFlags.length > 0
                  ? opened.redFlags.join(", ")
                  : opened.redFlagsDenied
                    ? "пациент отметил, что их нет"
                    : "не уточнялись"}
              </dd>
            </dl>
            <p className="text-caption text-muted">
              Открытие записано в журнал доступа. Пациент может отозвать
              согласие — тогда сведения удаляются.
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}
