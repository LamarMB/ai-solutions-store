"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  api,
  ApiError,
  dayChip,
  formatDay,
  rub,
  useApi,
  type ClinicInfo,
  type Doctor,
  type PatientBooking,
} from "@/components/miniapp/client";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Skeleton,
} from "@/components/miniapp/ui";
import { cn } from "@/lib/cn";

/** С чего начать: с выбора врача, с конкретного врача или с переноса записи. */
export type FlowStart = { doctorId?: string; reschedule?: PatientBooking };

type Step =
  | { step: "doctor" }
  | { step: "slot"; doctorId: string }
  | { step: "confirm"; doctorId: string; date: string; time: string }
  | { step: "done"; booking: PatientBooking };

/**
 * Запись (или перенос): врач → день → время → подтверждение → готово.
 * Дни и время — только реальные свободные слоты из общего расписания; запись
 * создаётся одним запросом после подтверждения. Повтор запроса (двойное
 * нажатие, обрыв сети) сервер не превращает во вторую запись.
 */
export function BookingFlow({
  clinic,
  start,
  onClose,
  onDone,
  onShowBookings,
}: {
  clinic: ClinicInfo;
  start: FlowStart;
  onClose: () => void;
  onDone: () => void;
  onShowBookings: () => void;
}) {
  const initialDoctor = start.reschedule?.doctorId ?? start.doctorId;
  const [state, setState] = useState<Step>(
    initialDoctor && clinic.doctors.some((d) => d.id === initialDoctor)
      ? { step: "slot", doctorId: initialDoctor }
      : { step: "doctor" },
  );
  const reschedule = start.reschedule;
  const doctorOf = (id: string) => clinic.doctors.find((d) => d.id === id);

  const back = () => {
    if (state.step === "confirm")
      setState({ step: "slot", doctorId: state.doctorId });
    else if (state.step === "slot" && !initialDoctor)
      setState({ step: "doctor" });
    else onClose();
  };

  const title =
    state.step === "done"
      ? reschedule
        ? "Запись перенесена"
        : "Вы записаны"
      : reschedule
        ? "Перенос записи"
        : "Запись к врачу";

  return (
    <div className="miniapp-screen bg-bg flex min-h-dvh flex-col">
      <header className="border-border bg-surface sticky top-0 z-10 flex items-center gap-2 border-b px-2 py-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
        {state.step !== "done" && (
          <button
            type="button"
            onClick={back}
            aria-label="Назад"
            className="text-ink flex size-10 items-center justify-center rounded-full"
          >
            <Icon name="chevron-left" size={24} />
          </button>
        )}
        <h1 className="text-body flex-1 px-2 font-semibold">{title}</h1>
        {state.step !== "done" && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="text-muted flex size-10 items-center justify-center rounded-full"
          >
            <Icon name="close" size={22} />
          </button>
        )}
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-4">
        {state.step !== "done" && (
          <Steps
            current={
              state.step === "doctor" ? 0 : state.step === "slot" ? 1 : 2
            }
          />
        )}
        {state.step === "doctor" && (
          <ChooseDoctor
            clinic={clinic}
            onChoose={(doctorId) => setState({ step: "slot", doctorId })}
          />
        )}
        {state.step === "slot" && doctorOf(state.doctorId) && (
          <ChooseSlot
            key={state.doctorId}
            doctor={doctorOf(state.doctorId)!}
            onChoose={(date, time) =>
              setState({
                step: "confirm",
                doctorId: state.doctorId,
                date,
                time,
              })
            }
          />
        )}
        {state.step === "confirm" && doctorOf(state.doctorId) && (
          <Confirm
            clinic={clinic}
            doctor={doctorOf(state.doctorId)!}
            date={state.date}
            time={state.time}
            reschedule={reschedule}
            onBooked={(booking) => {
              setState({ step: "done", booking });
              onDone();
            }}
            onSlotGone={() =>
              setState({ step: "slot", doctorId: state.doctorId })
            }
          />
        )}
        {state.step === "done" && (
          <Done
            clinic={clinic}
            booking={state.booking}
            onShowBookings={onShowBookings}
            onClose={onClose}
          />
        )}
      </main>
    </div>
  );
}

function Steps({ current }: { current: number }) {
  return (
    <ol className="mb-5 grid grid-cols-3 gap-2" aria-label="Шаги записи">
      {["Врач", "Дата и время", "Подтверждение"].map((label, i) => (
        <li key={label} className="flex flex-col gap-1.5">
          <span
            className={cn(
              "h-1 rounded-full",
              i <= current ? "bg-accent" : "bg-surface-2",
            )}
          />
          <span
            className={cn(
              "text-caption",
              i === current ? "text-ink font-semibold" : "text-muted",
            )}
            aria-current={i === current ? "step" : undefined}
          >
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ChooseDoctor({
  clinic,
  onChoose,
}: {
  clinic: ClinicInfo;
  onChoose: (doctorId: string) => void;
}) {
  if (clinic.doctors.length === 0)
    return (
      <EmptyState
        title="Сейчас нет врачей для записи"
        text="Попробуйте позже или напишите в сообщения сообщества."
      />
    );
  return (
    <ul className="flex flex-col gap-3">
      {clinic.specialties.map((s) => {
        const doctors = clinic.doctors.filter((d) => d.specialtyId === s.id);
        if (doctors.length === 0) return null;
        return (
          <li key={s.id}>
            <p className="text-small text-muted mb-2 font-medium">{s.title}</p>
            <ul className="flex flex-col gap-2">
              {doctors.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => onChoose(d.id)}
                    className="border-border bg-surface rounded-card flex w-full items-center gap-3 border p-4 text-left transition-transform active:scale-[0.99]"
                  >
                    <Avatar name={d.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{d.name}</span>
                      <span className="text-small text-muted block">
                        {d.nearest
                          ? `ближайшее: ${formatDay(d.nearest.date)}, ${d.nearest.time}`
                          : "нет свободного времени в ближайшие дни"}
                      </span>
                    </span>
                    <Icon name="chevron-right" size={20} />
                  </button>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
  return (
    <span
      aria-hidden
      className="bg-accent-soft text-accent flex size-12 shrink-0 items-center justify-center rounded-full font-semibold"
    >
      {initials}
    </span>
  );
}

function ChooseSlot({
  doctor,
  onChoose,
}: {
  doctor: Doctor;
  onChoose: (date: string, time: string) => void;
}) {
  const days = useApi<string[]>(
    `doctors/${encodeURIComponent(doctor.id)}/days`,
  );
  const [picked, setPicked] = useState<string>();
  const date = picked ?? days.data?.[0];
  const slots = useApi<string[]>(
    date ? `doctors/${encodeURIComponent(doctor.id)}/slots?date=${date}` : null,
  );

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex items-center gap-3">
        <Avatar name={doctor.name} />
        <div className="min-w-0">
          <p className="font-semibold">{doctor.name}</p>
          <p className="text-small text-muted">
            {doctor.specialty} · {doctor.slotMinutes} мин
            {doctor.priceRub !== null && ` · ${rub(doctor.priceRub)}`}
          </p>
        </div>
      </Card>

      <section>
        <h2 className="mb-2 font-semibold">Дата</h2>
        {days.error ? (
          <ErrorState error={days.error} onRetry={days.reload} />
        ) : days.loading && !days.data ? (
          <Skeleton rows={1} />
        ) : days.data && days.data.length === 0 ? (
          <EmptyState
            title="Свободного времени нет"
            text="В ближайшие две недели у врача нет свободных окон. Выберите другого врача."
          />
        ) : (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {days.data?.map((d) => {
              const chip = dayChip(d);
              const active = d === date;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setPicked(d)}
                  aria-pressed={active}
                  className={cn(
                    "rounded-card flex w-16 shrink-0 flex-col items-center border py-2.5 transition-colors",
                    active
                      ? "border-accent bg-accent text-accent-ink"
                      : "border-border bg-surface text-ink",
                  )}
                >
                  <span className="text-caption opacity-80">
                    {chip.weekday}
                  </span>
                  <span className="text-h3 font-semibold">{chip.day}</span>
                  <span className="text-caption opacity-80">{chip.month}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {date && (
        <section>
          <h2 className="mb-2 font-semibold">Время · {formatDay(date)}</h2>
          {slots.error ? (
            <ErrorState error={slots.error} onRetry={slots.reload} />
          ) : slots.loading ? (
            <Skeleton rows={1} />
          ) : slots.data && slots.data.length === 0 ? (
            <p className="text-muted text-small">
              На этот день время уже разобрали. Выберите другой день.
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {slots.data?.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => onChoose(date, t)}
                  className="border-border bg-surface text-ink rounded-field hover:border-accent h-11 border font-semibold transition-colors"
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Confirm({
  clinic,
  doctor,
  date,
  time,
  reschedule,
  onBooked,
  onSlotGone,
}: {
  clinic: ClinicInfo;
  doctor: Doctor;
  date: string;
  time: string;
  reschedule?: PatientBooking;
  onBooked: (booking: PatientBooking) => void;
  onSlotGone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const slot = { doctorId: doctor.id, date, time };
    try {
      const booking = reschedule
        ? await api<PatientBooking>(`bookings/${reschedule.id}`, {
            method: "PATCH",
            body: { action: "reschedule", ...slot },
          })
        : await api<PatientBooking>("bookings", { method: "POST", body: slot });
      onBooked(booking);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e
          : new ApiError("Не удалось записаться.", 0, "server"),
      );
      setBusy(false);
    }
  }

  const gone = error && ["taken", "unavailable"].includes(error.code);
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <dl className="flex flex-col gap-3">
          <Row label="Врач">
            {doctor.name}
            <span className="text-small text-muted block">
              {doctor.specialty}
            </span>
          </Row>
          <Row label="Дата и время">
            {formatDay(date)}, {time}
            <span className="text-small text-muted block">
              приём {doctor.slotMinutes} мин
            </span>
          </Row>
          {doctor.priceRub !== null && (
            <Row label="Стоимость приёма">{rub(doctor.priceRub)}</Row>
          )}
          <Row label="Адрес">{clinic.address}</Row>
          {reschedule && (
            <Row label="Вместо">
              {formatDay(reschedule.date)}, {reschedule.time} —{" "}
              {reschedule.doctorName}
            </Row>
          )}
        </dl>
      </Card>
      <p className="text-caption text-muted">
        Демо: клиника и расписание вымышленные, запись тестовая. Отменить или
        перенести запись можно в разделе «Записи».
      </p>
      {error && (
        <ErrorState error={error} onRetry={gone ? undefined : submit} />
      )}
      {gone ? (
        <Button block onClick={onSlotGone}>
          Выбрать другое время
        </Button>
      ) : (
        <Button block onClick={submit} disabled={busy}>
          {busy
            ? "Записываем…"
            : reschedule
              ? "Перенести запись"
              : "Подтвердить запись"}
        </Button>
      )}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function Done({
  clinic,
  booking,
  onShowBookings,
  onClose,
}: {
  clinic: ClinicInfo;
  booking: PatientBooking;
  onShowBookings: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 pt-4 text-center">
      <span className="miniapp-pop bg-accent text-accent-ink flex size-16 items-center justify-center rounded-full">
        <Icon name="check" size={32} />
      </span>
      <div>
        <p className="text-h3 font-semibold">Запись №{booking.id}</p>
        <p className="text-muted">
          {formatDay(booking.date)}, {booking.time}
        </p>
      </div>
      <Card className="w-full text-left">
        <p className="font-semibold">{booking.doctorName}</p>
        <p className="text-small text-muted">{booking.specialty}</p>
        <p className="text-small mt-3">{clinic.address}</p>
        {booking.priceRub !== null && (
          <p className="text-small mt-1">
            Стоимость приёма: {rub(booking.priceRub)}
          </p>
        )}
      </Card>
      {clinic.visitTips.length > 0 && (
        <Card className="w-full text-left">
          <p className="mb-2 font-semibold">Перед визитом</p>
          <ul className="text-small text-muted flex list-disc flex-col gap-1 pl-5">
            {clinic.visitTips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </Card>
      )}
      <div className="flex w-full flex-col gap-2">
        <Button block onClick={onShowBookings}>
          Мои записи
        </Button>
        <Button block variant="secondary" onClick={onClose}>
          На главную
        </Button>
      </div>
    </div>
  );
}
