"use client";

import { useState } from "react";
import { api, ApiError } from "@/components/admin/client";
import {
  DangerButton,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Panel,
  useToast,
} from "@/components/admin/ui";
import { Button } from "@/components/ui/Button";

type Note = { category: string; count?: number; reason: string };
type Summary = {
  vkId: number;
  found: boolean;
  counts: Record<string, number>;
  retained: Note[];
  withheld: Note[];
  token: string;
};

const LABELS: Record<string, string> = {
  bookings: "Записи на приём",
  upcomingBookings: "из них предстоящие (слоты освободятся)",
  conversation: "Разговор с ботом",
  consents: "Согласия на передачу сведений врачу",
  requests: "Обращения к администратору",
  pause: "Пауза бота после вызова администратора",
  notices: "Служебные уведомления",
  processedEvents: "Отметки обработанных сообщений",
};

/**
 * Запрос пациента о своих данных (P0-11): поиск по VK ID, выгрузка JSON,
 * удаление с предпросмотром и повторным вводом VK ID. VK ID передаётся только
 * в теле запроса — в адресе он попал бы в журналы сервера.
 */
export function Patients() {
  const toast = useToast();
  const [vkId, setVkId] = useState("");
  const [summary, setSummary] = useState<Summary>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [confirmError, setConfirmError] = useState<string>();

  async function search(id = vkId) {
    setBusy(true);
    setError(undefined);
    try {
      setSummary(
        await api<Summary>("patients/search", {
          method: "POST",
          body: { vkId: id.trim() },
        }),
      );
    } catch (e) {
      setSummary(undefined);
      setError(e instanceof Error ? e.message : "Не удалось выполнить поиск.");
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    if (!summary) return;
    setBusy(true);
    try {
      const data = await api("patients/export", {
        method: "POST",
        body: { vkId: String(summary.vkId) },
      });
      const url = URL.createObjectURL(
        new Blob([`${JSON.stringify(data, null, 2)}\n`], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `patient-data-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast("Выгрузка сохранена. Передайте файл пациенту защищённым способом.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выгрузить.");
    } finally {
      setBusy(false);
    }
  }

  async function erase() {
    if (!summary) return;
    setBusy(true);
    setConfirmError(undefined);
    try {
      await api("patients/erase", {
        method: "POST",
        body: {
          vkId: String(summary.vkId),
          confirm: confirm.trim(),
          token: summary.token,
        },
      });
      setConfirmOpen(false);
      setConfirm("");
      toast("Данные пациента удалены.");
      await search(String(summary.vkId));
    } catch (e) {
      setConfirmError(
        e instanceof ApiError
          ? e.message
          : "Не удалось удалить. Ничего не изменено.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Данные пациента"
        description="Ответ на запрос пациента: что о нём хранится в этой клинике, выгрузка и удаление по VK ID."
      />
      <Panel>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <div className="w-full max-w-xs">
            <Field
              label="VK ID пациента"
              hint="Число из адреса страницы ВКонтакте (id…)"
            >
              {(props) => (
                <Input
                  {...props}
                  inputMode="numeric"
                  autoComplete="off"
                  value={vkId}
                  onChange={(e) => setVkId(e.target.value)}
                />
              )}
            </Field>
          </div>
          <Button type="submit" disabled={busy || !vkId.trim()}>
            {busy && !summary ? "Ищу…" : "Найти"}
          </Button>
        </form>
        {error && (
          <div className="mt-4">
            <ErrorNote message={error} />
          </div>
        )}
      </Panel>

      {summary && (
        <Panel title={`VK ID ${summary.vkId}`} className="mt-6">
          {!summary.found ? (
            <p className="text-muted">
              В этой клинике данных пациента с таким VK ID нет.
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              <dl className="grid gap-2 sm:grid-cols-2">
                {Object.entries(summary.counts).map(([key, n]) => (
                  <div
                    key={key}
                    className="border-border flex justify-between gap-3 border-b py-1"
                  >
                    <dt className="text-small">{LABELS[key] ?? key}</dt>
                    <dd className="font-semibold">{n}</dd>
                  </div>
                ))}
              </dl>
              <NoteList
                title="Не выгружается через панель"
                notes={summary.withheld}
              />
              <NoteList
                title="Сохранится после удаления"
                notes={summary.retained}
              />
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" onClick={download} disabled={busy}>
                  Скачать выгрузку (JSON)
                </Button>
                <DangerButton
                  onClick={() => setConfirmOpen(true)}
                  disabled={busy}
                >
                  Удалить данные пациента…
                </DangerButton>
              </div>
            </div>
          )}
        </Panel>
      )}

      <Modal
        open={confirmOpen}
        title="Удалить данные пациента?"
        onClose={() => {
          setConfirmOpen(false);
          setConfirm("");
          setConfirmError(undefined);
        }}
      >
        <div className="text-small flex flex-col gap-3">
          <p>
            Будут удалены безвозвратно: записи ({summary?.counts.bookings ?? 0},
            предстоящие — {summary?.counts.upcomingBookings ?? 0}, их слоты
            освободятся), разговор с ботом, согласия, обращения и служебные
            отметки. Другие пациенты не затрагиваются.
          </p>
          <p className="text-muted">
            Данные останутся в резервных копиях до окончания срока их хранения.
            Удаление записывается в журнал действий без VK ID.
          </p>
          <Field label="Введите VK ID ещё раз" error={confirmError}>
            {(props) => (
              <Input
                {...props}
                inputMode="numeric"
                autoComplete="off"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="secondary"
            onClick={() => {
              setConfirmOpen(false);
              setConfirm("");
              setConfirmError(undefined);
            }}
            disabled={busy}
          >
            Не удалять
          </Button>
          <DangerButton
            onClick={erase}
            disabled={busy || confirm.trim() !== String(summary?.vkId ?? "")}
          >
            {busy ? "Удаляю…" : "Удалить безвозвратно"}
          </DangerButton>
        </div>
      </Modal>
    </>
  );
}

function NoteList({ title, notes }: { title: string; notes: Note[] }) {
  if (notes.length === 0) return null;
  return (
    <div>
      <h3 className="text-small mb-2 font-semibold">{title}</h3>
      <ul className="text-small text-muted flex flex-col gap-1">
        {notes.map((n) => (
          <li key={n.category}>
            <span className="text-ink">
              {n.category}
              {n.count !== undefined ? ` (${n.count})` : ""}
            </span>
            : {n.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
