"use client";

import Link from "next/link";
import { useState } from "react";
import type { Specialty } from "@/bot/clinic/types";
import type { AdminDoctor } from "@/bot/storage/clinic-store";
import { api, ApiError, useResource } from "@/components/admin/client";
import { rub } from "@/components/admin/format";
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
  Textarea,
  useToast,
} from "@/components/admin/ui";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

type DoctorsData = { doctors: AdminDoctor[]; specialties: Specialty[] };

type DoctorForm = {
  name: string;
  specialtyId: string;
  about: string;
  slotMinutes: string;
  priceRub: string;
};

const emptyForm = (specialtyId = ""): DoctorForm => ({
  name: "",
  specialtyId,
  about: "",
  slotMinutes: "30",
  priceRub: "",
});

function DoctorEditor({
  doctor,
  open,
  specialties,
  onClose,
  onSaved,
}: {
  doctor?: AdminDoctor;
  open: boolean;
  specialties: Specialty[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<DoctorForm>(() =>
    doctor
      ? {
          name: doctor.name,
          specialtyId: doctor.specialtyId,
          about: doctor.about,
          slotMinutes: String(doctor.slotMinutes),
          priceRub:
            doctor.priceRub !== undefined ? String(doctor.priceRub) : "",
        }
      : emptyForm(specialties[0]?.id),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (key: keyof DoctorForm) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    setBusy(true);
    setError(undefined);
    setErrors({});
    const body = {
      name: form.name,
      specialtyId: form.specialtyId,
      about: form.about,
      slotMinutes: Number(form.slotMinutes),
      priceRub: form.priceRub.trim() === "" ? null : Number(form.priceRub),
    };
    try {
      await api(doctor ? `doctors/${doctor.id}` : "doctors", {
        method: doctor ? "PATCH" : "POST",
        body,
      });
      toast(
        doctor
          ? "Данные врача сохранены"
          : "Врач добавлен. Задайте ему часы приёма в разделе «Расписание».",
      );
      onSaved();
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setErrors(e.fields);
      } else setError("Не удалось сохранить.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={doctor ? "Редактировать врача" : "Новый врач"}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        {error && <ErrorNote message={error} />}
        <Field
          label="Имя врача"
          error={errors.name}
          hint="Демо: только вымышленные имена."
        >
          {(props) => (
            <Input
              {...props}
              value={form.name}
              onChange={(e) => set("name")(e.target.value)}
              maxLength={80}
            />
          )}
        </Field>
        <Field label="Специальность" error={errors.specialtyId}>
          {(props) => (
            <Select
              {...props}
              value={form.specialtyId}
              onChange={(e) => set("specialtyId")(e.target.value)}
            >
              {specialties.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Описание для пациентов"
          error={errors.about}
          hint="Коротко: кого принимает, чем занимается."
        >
          {(props) => (
            <Textarea
              {...props}
              value={form.about}
              onChange={(e) => set("about")(e.target.value)}
              maxLength={300}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Длительность приёма, мин" error={errors.slotMinutes}>
            {(props) => (
              <Input
                {...props}
                type="number"
                min={10}
                max={180}
                step={5}
                value={form.slotMinutes}
                onChange={(e) => set("slotMinutes")(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Стоимость приёма, ₽"
            error={errors.priceRub}
            hint="Можно оставить пустым."
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                step={50}
                value={form.priceRub}
                onChange={(e) => set("priceRub")(e.target.value)}
              />
            )}
          </Field>
        </div>
        {doctor &&
          Number(form.slotMinutes) !== doctor.slotMinutes &&
          doctor.upcoming > 0 && (
            <p className="text-small text-warning">
              У врача {doctor.upcoming} предстоящих записей. Они сохранятся;
              новое время будет считаться по новой длительности.
            </p>
          )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Сохраняю…" : "Сохранить"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function SpecialtyEditor({
  specialty,
  open,
  onClose,
  onSaved,
}: {
  specialty?: Specialty;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(specialty?.title ?? "");
  const [toWhom, setToWhom] = useState(specialty?.toWhom ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      await api(specialty ? `specialties/${specialty.id}` : "specialties", {
        method: specialty ? "PATCH" : "POST",
        body: { title, toWhom },
      });
      toast("Специальность сохранена");
      onSaved();
      onClose();
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

  return (
    <Modal
      open={open}
      title={specialty ? "Специальность" : "Новая специальность"}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        {errors._ && <ErrorNote message={errors._} />}
        <Field label="Название" error={errors.title} hint="Например: Невролог">
          {(props) => (
            <Input
              {...props}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={60}
            />
          )}
        </Field>
        <Field
          label="Как бот пишет «к кому»"
          error={errors.toWhom}
          hint="Например: к неврологу"
        >
          {(props) => (
            <Input
              {...props}
              value={toWhom}
              onChange={(e) => setToWhom(e.target.value)}
              maxLength={80}
            />
          )}
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Сохраняю…" : "Сохранить"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function Doctors() {
  const toast = useToast();
  const { data, error, loading, reload } = useResource<DoctorsData>("doctors");
  const [editing, setEditing] = useState<AdminDoctor | "new" | null>(null);
  const [specialty, setSpecialty] = useState<Specialty | "new" | null>(null);
  const [confirm, setConfirm] = useState<{
    doctor: AdminDoctor;
    kind: "disable" | "delete";
  } | null>(null);
  const [busy, setBusy] = useState(false);

  async function apply(
    doctor: AdminDoctor,
    kind: "enable" | "disable" | "delete",
  ) {
    setBusy(true);
    try {
      if (kind === "delete")
        await api(`doctors/${doctor.id}`, { method: "DELETE" });
      else
        await api(`doctors/${doctor.id}`, {
          method: "PATCH",
          body: { active: kind === "enable" },
        });
      toast(
        kind === "delete"
          ? `${doctor.name} удалён(а) из списка врачей`
          : kind === "enable"
            ? `${doctor.name}: запись открыта`
            : `${doctor.name}: запись закрыта, бот не предлагает врача`,
      );
      reload();
      setConfirm(null);
    } catch (e) {
      toast(
        e instanceof ApiError ? e.message : "Не удалось выполнить действие.",
        "error",
      );
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;
  const specialtyTitle = (id: string) =>
    data.specialties.find((s) => s.id === id)?.title ?? "—";

  return (
    <>
      <PageHeader
        title="Врачи"
        description="Изменения сразу видны боту ВКонтакте: список врачей, цены и описание."
        actions={
          <Button onClick={() => setEditing("new")}>Добавить врача</Button>
        }
      />

      {data.doctors.length === 0 ? (
        <EmptyState
          title="Врачей пока нет"
          action={
            <Button onClick={() => setEditing("new")}>Добавить врача</Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.doctors.map((d) => (
            <Panel key={d.id} className={cn(!d.active && "opacity-70")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-h3 font-semibold">{d.name}</h2>
                  <p className="text-small text-muted">
                    {specialtyTitle(d.specialtyId)}
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-control text-caption px-2.5 py-0.5 font-medium whitespace-nowrap",
                    d.active
                      ? "bg-success/15 text-success"
                      : "bg-surface-2 text-muted",
                  )}
                >
                  {d.active ? "Принимает" : "Отключён"}
                </span>
              </div>
              {d.about && <p className="text-small mt-3">{d.about}</p>}
              <dl className="text-small mt-3 flex flex-wrap gap-x-6 gap-y-1">
                <div>
                  <dt className="text-muted inline">Приём: </dt>
                  <dd className="inline">{d.slotMinutes} мин</dd>
                </div>
                <div>
                  <dt className="text-muted inline">Стоимость: </dt>
                  <dd className="inline">
                    {d.priceRub !== undefined
                      ? rub(d.priceRub)
                      : "по прайсу услуг"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted inline">Предстоящих записей: </dt>
                  <dd className="inline">{d.upcoming}</dd>
                </div>
                <div>
                  <dt className="text-muted inline">Часы: </dt>
                  <dd className="inline">
                    {d.hours.length
                      ? `${new Set(d.hours.map((h) => h.weekday)).size} дн. в неделю`
                      : "не заданы"}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setEditing(d)}
                >
                  Изменить
                </Button>
                <Link
                  href={`/admin/schedule?doctor=${d.id}`}
                  className="text-small text-accent hover:text-accent-hover inline-flex h-9 items-center px-2"
                >
                  Расписание
                </Link>
                {d.active ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirm({ doctor: d, kind: "disable" })}
                  >
                    Отключить
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => apply(d, "enable")}
                    disabled={busy}
                  >
                    Включить
                  </Button>
                )}
                <DangerButton
                  small
                  onClick={() => setConfirm({ doctor: d, kind: "delete" })}
                >
                  Удалить
                </DangerButton>
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Panel
        title="Специальности"
        className="mt-8"
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setSpecialty("new")}
          >
            Добавить специальность
          </Button>
        }
      >
        <ul className="flex flex-wrap gap-2">
          {data.specialties.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setSpecialty(s)}
                className="border-border-strong hover:border-accent rounded-control text-small border px-3 py-1.5"
              >
                {s.title}
              </button>
            </li>
          ))}
        </ul>
        <p className="text-caption text-muted mt-3">
          Подбор специалиста по жалобам в боте знает только прежние направления
          клиники; новые специальности доступны для записи из меню.
        </p>
      </Panel>

      {editing && (
        <DoctorEditor
          key={editing === "new" ? "new" : editing.id}
          open
          doctor={editing === "new" ? undefined : editing}
          specialties={data.specialties}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
      {specialty && (
        <SpecialtyEditor
          key={specialty === "new" ? "new" : specialty.id}
          open
          specialty={specialty === "new" ? undefined : specialty}
          onClose={() => setSpecialty(null)}
          onSaved={reload}
        />
      )}
      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm?.kind === "delete" ? "Удалить врача?" : "Отключить врача?"
        }
        text={
          confirm?.kind === "delete"
            ? confirm.doctor.upcoming > 0
              ? `У врача ${confirm.doctor.upcoming} предстоящих записей — удалить его нельзя. Перенесите или отмените записи либо просто отключите врача.`
              : "Врач исчезнет из списка и расписания. Прошлые записи сохранятся с его именем."
            : "Бот перестанет предлагать этого врача. Уже сделанные записи сохранятся."
        }
        confirmLabel={confirm?.kind === "delete" ? "Удалить" : "Отключить"}
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && apply(confirm.doctor, confirm.kind)}
      />
    </>
  );
}
