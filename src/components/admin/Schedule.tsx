"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { Specialty } from "@/bot/clinic/types";
import type { AdminDoctor, ExceptionRow } from "@/bot/storage/clinic-store";
import { api, ApiError, useResource } from "@/components/admin/client";
import { formatDate, WEEKDAYS } from "@/components/admin/format";
import {
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Loading,
  PageHeader,
  Panel,
  Select,
  useToast,
} from "@/components/admin/ui";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

type DoctorsData = { doctors: AdminDoctor[]; specialties: Specialty[] };
type Interval = { weekday: number; from: string; to: string };

function HoursEditor({
  doctor,
  onSaved,
}: {
  doctor: AdminDoctor;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [hours, setHours] = useState<Interval[]>(
    doctor.hours.map((h) => ({ ...h })),
  );
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const update = (index: number, patch: Partial<Interval>) =>
    setHours((list) =>
      list.map((h, i) => (i === index ? { ...h, ...patch } : h)),
    );

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await api(`schedule/${doctor.id}/hours`, {
        method: "PUT",
        body: { hours },
      });
      toast("Часы приёма сохранены. Бот уже предлагает новое время.");
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось сохранить.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Часы приёма по дням недели"
      actions={
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? "Сохраняю…" : "Сохранить часы"}
        </Button>
      }
    >
      <p className="text-small text-muted mb-4">
        Длительность приёма — {doctor.slotMinutes} мин (меняется в разделе
        «Врачи»). День без интервалов — выходной.
      </p>
      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}
      <ul className="flex flex-col">
        {WEEKDAYS.map((day) => {
          const intervals = hours
            .map((h, index) => ({ ...h, index }))
            .filter((h) => h.weekday === day.id);
          return (
            <li
              key={day.id}
              className="border-border flex flex-col gap-2 border-t py-3 first:border-t-0 sm:flex-row sm:items-start"
            >
              <span className="w-32 shrink-0 pt-2 font-medium">{day.long}</span>
              <div className="flex flex-1 flex-col gap-2">
                {intervals.length === 0 && (
                  <span className="text-small text-muted pt-2">Выходной</span>
                )}
                {intervals.map((h) => (
                  <div
                    key={h.index}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <Input
                      type="time"
                      aria-label={`${day.long}: начало`}
                      value={h.from}
                      step={300}
                      onChange={(e) =>
                        update(h.index, { from: e.target.value })
                      }
                      narrow
                    />
                    <span className="text-muted">—</span>
                    <Input
                      type="time"
                      aria-label={`${day.long}: конец`}
                      value={h.to}
                      step={300}
                      onChange={(e) => update(h.index, { to: e.target.value })}
                      narrow
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setHours((list) => list.filter((_, i) => i !== h.index))
                      }
                    >
                      Убрать
                    </Button>
                  </div>
                ))}
                <div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setHours((list) => [
                        ...list,
                        { weekday: day.id, from: "09:00", to: "13:00" },
                      ])
                    }
                  >
                    + интервал
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function Exceptions({
  doctor,
  today,
  onChanged,
}: {
  doctor: AdminDoctor;
  today: string;
  onChanged: () => void;
}) {
  const toast = useToast();
  const { data, error, loading, reload } =
    useResource<ExceptionRow[]>("exceptions");
  const [form, setForm] = useState({
    scope: "doctor",
    date: today,
    allDay: true,
    from: "13:00",
    to: "14:00",
    reason: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<ExceptionRow | null>(null);

  async function add() {
    setBusy(true);
    setErrors({});
    try {
      const result = await api<{ affectedBookings: number }>("exceptions", {
        method: "POST",
        body: {
          doctorId: form.scope === "doctor" ? doctor.id : null,
          date: form.date,
          from: form.allDay ? null : form.from,
          to: form.allDay ? null : form.to,
          reason: form.reason,
        },
      });
      toast(
        result.affectedBookings > 0
          ? `Сохранено. Внимание: на это время уже есть записей — ${result.affectedBookings}. Перенесите их в разделе «Записи».`
          : "Сохранено. Бот не будет предлагать это время.",
        result.affectedBookings > 0 ? "error" : "ok",
      );
      reload();
      onChanged();
    } catch (e) {
      setErrors(
        e instanceof ApiError
          ? { ...e.fields, _: e.message }
          : { _: "Не удалось сохранить." },
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: ExceptionRow) {
    setBusy(true);
    try {
      await api(`exceptions/${row.id}`, { method: "DELETE" });
      toast("Удалено: время снова доступно для записи.");
      reload();
      onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не удалось удалить.", "error");
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  }

  const rows = (data ?? []).filter(
    (e) => !e.doctorId || e.doctorId === doctor.id,
  );
  return (
    <Panel title="Выходные и недоступное время">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Для кого">
          {(props) => (
            <Select
              {...props}
              value={form.scope}
              onChange={(e) => setForm({ ...form, scope: e.target.value })}
            >
              <option value="doctor">Только {doctor.name}</option>
              <option value="clinic">Вся клиника (праздник)</option>
            </Select>
          )}
        </Field>
        <Field label="Дата" error={errors.date}>
          {(props) => (
            <Input
              {...props}
              type="date"
              min={today}
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          )}
        </Field>
        <Field label="Причина (необязательно)" error={errors.reason}>
          {(props) => (
            <Input
              {...props}
              value={form.reason}
              maxLength={100}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="отпуск, совещание…"
            />
          )}
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="text-small flex h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={form.allDay}
            onChange={(e) => setForm({ ...form, allDay: e.target.checked })}
            className="accent-accent size-4"
          />
          Весь день
        </label>
        {!form.allDay && (
          <>
            <Field label="С">
              {(props) => (
                <Input
                  {...props}
                  type="time"
                  value={form.from}
                  onChange={(e) => setForm({ ...form, from: e.target.value })}
                  narrow
                />
              )}
            </Field>
            <Field label="До">
              {(props) => (
                <Input
                  {...props}
                  type="time"
                  value={form.to}
                  onChange={(e) => setForm({ ...form, to: e.target.value })}
                  narrow
                />
              )}
            </Field>
          </>
        )}
        <Button onClick={add} disabled={busy}>
          Добавить
        </Button>
      </div>
      {errors._ && (
        <div className="mt-4">
          <ErrorNote message={errors._} />
        </div>
      )}

      <div className="mt-6">
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorNote message={error} onRetry={reload} />
        ) : rows.length === 0 ? (
          <EmptyState title="Выходных и перерывов не запланировано" />
        ) : (
          <ul>
            {rows.map((row) => (
              <li
                key={row.id}
                className="border-border flex flex-wrap items-center gap-x-4 gap-y-1 border-t py-3 first:border-t-0"
              >
                <span className="w-44 font-medium">{formatDate(row.date)}</span>
                <span className="text-small flex-1">
                  {row.from ? `${row.from}–${row.to}` : "весь день"} ·{" "}
                  {row.doctorId ? doctor.name : "вся клиника"}
                  {row.reason ? ` · ${row.reason}` : ""}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setRemoving(row)}
                >
                  Удалить
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={removing !== null}
        title="Удалить из расписания?"
        text="Это время снова станет доступно для записи — в том числе через бота."
        confirmLabel="Удалить"
        busy={busy}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove(removing)}
      />
    </Panel>
  );
}

function FreeSlots({
  doctor,
  today,
  version,
}: {
  doctor: AdminDoctor;
  today: string;
  version: number;
}) {
  const [date, setDate] = useState(today);
  // version в адресе — повторная загрузка после изменения расписания.
  const { data, loading, error } = useResource<string[]>(
    `slots?doctorId=${encodeURIComponent(doctor.id)}&date=${date}&v=${version}`,
  );
  return (
    <Panel title="Свободное время">
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Дата">
          {(props) => (
            <Input
              {...props}
              type="date"
              min={today}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          )}
        </Field>
      </div>
      <div className="mt-4">
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorNote message={error} />
        ) : data && data.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {data.map((t) => (
              <li
                key={t}
                className="border-border-strong rounded-control text-small border px-3 py-1.5 tabular-nums"
              >
                {t}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-small text-muted">Свободного времени нет.</p>
        )}
      </div>
      <p className="text-caption text-muted mt-3">
        Двойная запись невозможна: занятое время не предлагается ни здесь, ни в
        боте.
      </p>
    </Panel>
  );
}

export function Schedule({ today }: { today: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const { data, error, loading, reload } = useResource<DoctorsData>("doctors");
  const [version, setVersion] = useState(0);
  const doctors = data?.doctors ?? [];
  const selectedId = search.get("doctor") ?? doctors[0]?.id ?? "";
  const doctor = doctors.find((d) => d.id === selectedId);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorNote message={error} onRetry={reload} />;
  if (doctors.length === 0)
    return (
      <>
        <PageHeader title="Расписание" />
        <EmptyState
          title="Сначала добавьте врача"
          text="Расписание задаётся для каждого врача отдельно."
        />
      </>
    );

  return (
    <>
      <PageHeader
        title="Расписание"
        description="Рабочие часы, выходные и перерывы. Бот предлагает только свободное время по этому расписанию."
      />
      <div className="mb-6 max-w-sm">
        <Field label="Врач">
          {(props) => (
            <Select
              {...props}
              value={selectedId}
              onChange={(e) =>
                router.replace(`/admin/schedule?doctor=${e.target.value}`)
              }
            >
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.active ? "" : " (отключён)"}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {doctor && (
        <div className={cn("grid gap-6", "lg:grid-cols-[1.4fr_1fr]")}>
          <HoursEditor
            key={`${doctor.id}:${JSON.stringify(doctor.hours)}`}
            doctor={doctor}
            onSaved={() => {
              reload();
              setVersion((v) => v + 1);
            }}
          />
          <FreeSlots doctor={doctor} today={today} version={version} />
          <div className="lg:col-span-2">
            <Exceptions
              doctor={doctor}
              today={today}
              onChanged={() => setVersion((v) => v + 1)}
            />
          </div>
        </div>
      )}
    </>
  );
}
