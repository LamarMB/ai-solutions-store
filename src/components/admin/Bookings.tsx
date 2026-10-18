"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { BookingView } from "@/admin/service";
import type { AdminDoctor } from "@/bot/storage/clinic-store";
import type { Specialty } from "@/bot/clinic/types";
import { api, ApiError, useResource } from "@/components/admin/client";
import {
  formatDate,
  formatMoment,
  shiftDate,
  SOURCE_LABELS,
  STATUS_LABELS,
} from "@/components/admin/format";
import {
  ConfirmDialog,
  DangerButton,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Panel,
  Select,
  StatusBadge,
  useToast,
} from "@/components/admin/ui";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

type DoctorsData = { doctors: AdminDoctor[]; specialties: Specialty[] };

/** Выбор врача, даты и свободного времени — по тому же расписанию, что у бота. */
export function SlotPicker({
  doctors,
  value,
  onChange,
  today,
}: {
  doctors: AdminDoctor[];
  value: { doctorId: string; date: string; time: string };
  onChange: (value: { doctorId: string; date: string; time: string }) => void;
  today: string;
}) {
  const ready = value.doctorId && value.date;
  const {
    data: slots,
    loading,
    error,
  } = useResource<string[]>(
    ready
      ? `slots?doctorId=${encodeURIComponent(value.doctorId)}&date=${value.date}`
      : null,
  );
  const active = doctors.filter((d) => d.active);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Врач">
          {(props) => (
            <Select
              {...props}
              value={value.doctorId}
              onChange={(e) =>
                onChange({ ...value, doctorId: e.target.value, time: "" })
              }
            >
              <option value="">Выберите врача</option>
              {active.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Дата">
          {(props) => (
            <Input
              {...props}
              type="date"
              min={today}
              value={value.date}
              onChange={(e) =>
                onChange({ ...value, date: e.target.value, time: "" })
              }
            />
          )}
        </Field>
      </div>
      <div>
        <p className="text-small mb-2 font-medium">Свободное время</p>
        {!ready ? (
          <p className="text-small text-muted">Выберите врача и дату.</p>
        ) : loading ? (
          <Loading label="Ищу свободное время…" />
        ) : error ? (
          <ErrorNote message={error} />
        ) : slots && slots.length > 0 ? (
          <div
            className="flex flex-wrap gap-2"
            role="radiogroup"
            aria-label="Свободное время"
          >
            {slots.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={value.time === t}
                onClick={() => onChange({ ...value, time: t })}
                className={cn(
                  "rounded-control text-small h-10 min-w-16 border px-3 tabular-nums transition-colors",
                  value.time === t
                    ? "border-accent bg-accent-soft text-ink"
                    : "border-border-strong hover:border-accent",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-small text-muted">
            На этот день свободного времени нет: выходной, приём не ведётся или
            всё занято.
          </p>
        )}
      </div>
    </div>
  );
}

function NewBooking({
  open,
  onClose,
  onCreated,
  doctors,
  today,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  doctors: AdminDoctor[];
  today: string;
}) {
  const toast = useToast();
  const [slot, setSlot] = useState({ doctorId: "", date: today, time: "" });
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const booking = await api<BookingView>("bookings", {
        method: "POST",
        body: { ...slot, note: note.trim() || undefined },
      });
      toast(
        `Запись №${booking.id} создана: ${formatDate(booking.date)}, ${booking.time}`,
      );
      setSlot({ doctorId: "", date: today, time: "" });
      setNote("");
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось записать.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Новая запись" onClose={onClose} wide>
      <div className="flex flex-col gap-5">
        {error && <ErrorNote message={error} />}
        <SlotPicker
          doctors={doctors}
          value={slot}
          onChange={setSlot}
          today={today}
        />
        <Field
          label="Пометка (необязательно)"
          hint="Демо-режим: не указывайте реальные ФИО, телефоны и жалобы пациентов."
        >
          {(props) => (
            <Input
              {...props}
              value={note}
              maxLength={120}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Например: первичный приём, звонок в регистратуру"
            />
          )}
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={save} disabled={busy || !slot.time}>
            {busy ? "Сохраняю…" : "Записать"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function BookingDetails({
  booking,
  doctors,
  today,
  onClose,
  onChanged,
}: {
  booking: BookingView | null;
  doctors: AdminDoctor[];
  today: string;
  onClose: () => void;
  onChanged: (updated: BookingView) => void;
}) {
  const toast = useToast();
  // Окно создаётся заново для каждой записи (key), поэтому состояние — из пропсов.
  const [mode, setMode] = useState<"view" | "move" | "cancel">("view");
  const [slot, setSlot] = useState({
    doctorId: booking?.doctorId ?? "",
    date: booking && booking.date >= today ? booking.date : today,
    time: "",
  });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (!booking) return null;

  async function update(body: unknown, message: string) {
    setBusy(true);
    setError(undefined);
    try {
      const updated = await api<BookingView>(`bookings/${booking!.id}`, {
        method: "PATCH",
        body,
      });
      toast(message);
      onChanged(updated);
      setMode("view");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось сохранить.");
    } finally {
      setBusy(false);
    }
  }

  const editable = booking.status === "confirmed";
  return (
    <>
      <Modal
        open={mode !== "cancel"}
        title={`Запись №${booking.id}`}
        onClose={onClose}
        wide={mode === "move"}
      >
        {error && (
          <div className="mb-4">
            <ErrorNote message={error} />
          </div>
        )}
        {mode === "view" ? (
          <>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-small text-muted">Дата и время</dt>
                <dd className="font-medium">
                  {formatDate(booking.date)}, {booking.time}
                </dd>
              </div>
              <div>
                <dt className="text-small text-muted">Статус</dt>
                <dd>
                  <StatusBadge status={booking.status} />
                </dd>
              </div>
              <div>
                <dt className="text-small text-muted">Врач</dt>
                <dd className="font-medium">{booking.doctorName}</dd>
                <dd className="text-small text-muted">
                  {booking.specialtyTitle}
                </dd>
              </div>
              <div>
                <dt className="text-small text-muted">Пациент</dt>
                <dd>{booking.patient}</dd>
              </div>
              <div>
                <dt className="text-small text-muted">Источник</dt>
                <dd>{SOURCE_LABELS[booking.source]}</dd>
              </div>
              <div>
                <dt className="text-small text-muted">Создана</dt>
                <dd>{formatMoment(booking.createdAt)}</dd>
              </div>
              {booking.note && (
                <div className="sm:col-span-2">
                  <dt className="text-small text-muted">Пометка</dt>
                  <dd>{booking.note}</dd>
                </div>
              )}
            </dl>
            {editable ? (
              <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button
                  onClick={() =>
                    update(
                      { action: "complete" },
                      "Приём отмечен как состоявшийся",
                    )
                  }
                  disabled={busy}
                >
                  Приём состоялся
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setMode("move")}
                  disabled={busy}
                >
                  Перенести
                </Button>
                <DangerButton onClick={() => setMode("cancel")} disabled={busy}>
                  Отменить запись
                </DangerButton>
              </div>
            ) : (
              <p className="text-small text-muted mt-6">
                Запись{" "}
                {booking.status === "cancelled" ? "отменена" : "завершена"} —
                изменить её нельзя.
              </p>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-5">
            <p className="text-small text-muted">
              Сейчас: {booking.doctorName}, {formatDate(booking.date)},{" "}
              {booking.time}. Выберите новое время.
            </p>
            <SlotPicker
              doctors={doctors}
              value={slot}
              onChange={setSlot}
              today={today}
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => setMode("view")}>
                Назад
              </Button>
              <Button
                disabled={busy || !slot.time}
                onClick={() =>
                  update(
                    { action: "reschedule", ...slot },
                    `Запись перенесена на ${formatDate(slot.date)}, ${slot.time}`,
                  )
                }
              >
                {busy ? "Переношу…" : "Перенести"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={mode === "cancel"}
        title="Отменить запись?"
        text={
          <>
            {booking.doctorName}, {formatDate(booking.date)}, {booking.time}.
            Время освободится для других пациентов. Пациента, записавшегося
            через ВКонтакте, бот сам не уведомит — при необходимости напишите
            ему в сообщениях сообщества.
          </>
        }
        confirmLabel="Отменить запись"
        busy={busy}
        onClose={() => setMode("view")}
        onConfirm={() => update({ action: "cancel" }, "Запись отменена")}
      />
    </>
  );
}

export function Bookings({ today }: { today: string }) {
  const search = useSearchParams();
  const [filters, setFilters] = useState({
    from: today,
    to: shiftDate(today, 30),
    doctorId: "",
    status: "",
    query: "",
  });
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(search.get("new") === "1");
  const [selected, setSelected] = useState<BookingView | null>(null);
  const doctors = useResource<DoctorsData>("doctors");

  const path = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters))
      if (value) params.set(key, value);
    return `bookings?${params}`;
  }, [filters]);
  const { data, error, loading, reload, setData } =
    useResource<BookingView[]>(path);

  // Поиск — с небольшой задержкой, чтобы не отправлять запрос на каждую букву.
  useEffect(() => {
    const timer = setTimeout(() => setFilters((f) => ({ ...f, query })), 350);
    return () => clearTimeout(timer);
  }, [query]);

  const doctorList = doctors.data?.doctors ?? [];
  const byDate = useMemo(() => {
    const groups = new Map<string, BookingView[]>();
    for (const b of data ?? [])
      groups.set(b.date, [...(groups.get(b.date) ?? []), b]);
    return [...groups.entries()];
  }, [data]);

  return (
    <>
      <PageHeader
        title="Записи пациентов"
        description="Записи из ВКонтакте и созданные вручную — в одном списке."
        actions={
          <Button onClick={() => setCreating(true)}>Новая запись</Button>
        }
      />

      <Panel className="mb-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="С даты">
            {(props) => (
              <Input
                {...props}
                type="date"
                value={filters.from}
                onChange={(e) =>
                  setFilters({ ...filters, from: e.target.value })
                }
              />
            )}
          </Field>
          <Field label="По дату">
            {(props) => (
              <Input
                {...props}
                type="date"
                value={filters.to}
                onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              />
            )}
          </Field>
          <Field label="Врач">
            {(props) => (
              <Select
                {...props}
                value={filters.doctorId}
                onChange={(e) =>
                  setFilters({ ...filters, doctorId: e.target.value })
                }
              >
                <option value="">Все врачи</option>
                {doctorList.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Статус">
            {(props) => (
              <Select
                {...props}
                value={filters.status}
                onChange={(e) =>
                  setFilters({ ...filters, status: e.target.value })
                }
              >
                <option value="">Все статусы</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Поиск" hint="Номер записи или текст пометки">
            {(props) => (
              <Input
                {...props}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="№ или пометка"
              />
            )}
          </Field>
        </div>
      </Panel>

      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : data && data.length === 0 ? (
        <EmptyState
          title="Записей не найдено"
          text="Измените период или фильтры — или создайте запись вручную."
          action={
            <Button variant="secondary" onClick={() => setCreating(true)}>
              Новая запись
            </Button>
          }
        />
      ) : (
        <div className={cn("flex flex-col gap-6", loading && "opacity-60")}>
          {byDate.map(([date, list]) => (
            <Panel key={date} title={formatDate(date)}>
              <ul>
                {list.map((b) => (
                  <li
                    key={b.id}
                    className="border-border border-t first:border-t-0"
                  >
                    <button
                      type="button"
                      onClick={() => setSelected(b)}
                      className="hover:bg-surface-2 rounded-field -mx-2 flex w-[calc(100%+1rem)] flex-wrap items-center gap-x-4 gap-y-1 px-2 py-3 text-left"
                    >
                      <span className="w-14 font-semibold tabular-nums">
                        {b.time}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{b.doctorName}</span>
                        <span className="text-small text-muted">
                          {" "}
                          · {b.specialtyTitle}
                        </span>
                        <span className="text-small text-muted block">
                          №{b.id} · {b.patient}
                          {b.note ? ` · ${b.note}` : ""}
                        </span>
                      </span>
                      <StatusBadge status={b.status} />
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      )}

      <NewBooking
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={reload}
        doctors={doctorList}
        today={today}
      />
      <BookingDetails
        key={selected?.id ?? "none"}
        booking={selected}
        doctors={doctorList}
        today={today}
        onClose={() => setSelected(null)}
        onChanged={(updated) => {
          setSelected(updated);
          setData((list) =>
            list?.map((b) => (b.id === updated.id ? updated : b)),
          );
        }}
      />
    </>
  );
}
