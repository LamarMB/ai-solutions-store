"use client";

import { useState, type ReactNode } from "react";
import { DoctorPortrait } from "@/components/miniapp/art";
import {
  api,
  ApiError,
  dayChip,
  dayName,
  longDay,
  rub,
  useApi,
  type ClinicInfo,
  type Doctor,
  type PatientBooking,
} from "@/components/miniapp/client";
import { MaIcon } from "@/components/miniapp/icons";
import {
  Button,
  Card,
  CardButton,
  Chip,
  EmptyState,
  ErrorState,
  Scroller,
  Skeleton,
  StickyFooter,
  TopBar,
} from "@/components/miniapp/ui";
import { cn } from "@/lib/cn";

/**
 * С чего начать запись: выбор врача (можно сразу по направлению), конкретный
 * врач, врач и время (из карточки врача) или перенос существующей записи.
 */
export type FlowStart = {
  doctorId?: string;
  specialtyId?: string;
  date?: string;
  time?: string;
  reschedule?: PatientBooking;
};

type Slot = { date: string; time: string };

/**
 * Запись или перенос: врач → дата и время → проверка → подтверждение.
 * Дни и время — только реальные свободные слоты общего расписания; запись
 * создаётся одним запросом по кнопке «Подтвердить запись». Повтор запроса
 * (двойное нажатие, обрыв сети) сервер не превращает во вторую запись.
 */
export function BookingFlow({
  clinic,
  start,
  onClose,
  onDone,
  onShowBookings,
  onHome,
}: {
  clinic: ClinicInfo;
  start: FlowStart;
  onClose: () => void;
  onDone: () => void;
  onShowBookings: () => void;
  onHome: () => void;
}) {
  const reschedule = start.reschedule;
  const presetDoctor = reschedule?.doctorId ?? start.doctorId;
  const known = (id?: string) =>
    id && clinic.doctors.some((d) => d.id === id) ? id : undefined;
  const [doctorId, setDoctorId] = useState(known(presetDoctor));
  const [picking, setPicking] = useState(!known(presetDoctor));
  const [slot, setSlot] = useState<Slot | undefined>(
    start.date && start.time
      ? { date: start.date, time: start.time }
      : undefined,
  );
  const [done, setDone] = useState<PatientBooking>();
  const doctor = clinic.doctors.find((d) => d.id === doctorId);

  if (done)
    return (
      <Success
        clinic={clinic}
        booking={done}
        rescheduled={Boolean(reschedule)}
        onShowBookings={onShowBookings}
        onHome={onHome}
      />
    );

  if (picking || !doctor)
    return (
      <ChooseDoctor
        clinic={clinic}
        specialtyId={start.specialtyId}
        onBack={doctor ? () => setPicking(false) : onClose}
        onChoose={(id) => {
          if (id !== doctorId) setSlot(undefined);
          setDoctorId(id);
          setPicking(false);
        }}
      />
    );

  return (
    <BookingForm
      key={doctor.id}
      clinic={clinic}
      doctor={doctor}
      slot={slot}
      onSlot={setSlot}
      reschedule={reschedule}
      onBack={onClose}
      onChangeDoctor={() => setPicking(true)}
      onBooked={(booking) => {
        setDone(booking);
        onDone();
      }}
    />
  );
}

/* Шаг 1: выбор врача */

function ChooseDoctor({
  clinic,
  specialtyId,
  onBack,
  onChoose,
}: {
  clinic: ClinicInfo;
  specialtyId?: string;
  onBack: () => void;
  onChoose: (doctorId: string) => void;
}) {
  const [filter, setFilter] = useState(
    specialtyId && clinic.specialties.some((s) => s.id === specialtyId)
      ? specialtyId
      : "all",
  );
  const doctors = clinic.doctors.filter(
    (d) => filter === "all" || d.specialtyId === filter,
  );
  return (
    <div className="miniapp-screen flex min-h-dvh flex-col">
      <TopBar title="Выберите врача" onBack={onBack} />
      <main className="mx-auto w-full max-w-xl flex-1 px-5 pt-2 pb-10">
        <Scroller label="Специальность">
          {[{ id: "all", title: "Все" }, ...clinic.specialties].map((s) => (
            <Chip
              key={s.id}
              active={filter === s.id}
              onClick={() => setFilter(s.id)}
            >
              {s.title}
            </Chip>
          ))}
        </Scroller>
        {doctors.length === 0 ? (
          <EmptyState
            icon="doctors"
            title="Сейчас нет врачей для записи"
            text="Попробуйте позже или напишите в сообщения сообщества."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {doctors.map((d) => (
              <li key={d.id}>
                <CardButton onClick={() => onChoose(d.id)}>
                  <DoctorPortrait
                    name={d.name}
                    specialtyId={d.specialtyId}
                    photoUrl={d.photoUrl}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block leading-snug font-semibold">
                      {d.name}
                    </span>
                    <span className="text-small text-accent block">
                      {d.specialty}
                    </span>
                    <span className="text-caption text-muted mt-1 block">
                      {d.nearest
                        ? `Ближайшее: ${longDay(d.nearest.date, clinic.today).toLowerCase()}, ${d.nearest.time}`
                        : "Нет свободного времени в ближайшие дни"}
                    </span>
                  </span>
                  <MaIcon name="chevron" size={20} className="text-muted" />
                </CardButton>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

/* Шаги 2–3: дата, время, проверка и подтверждение */

function Step({
  n,
  title,
  action,
  children,
}: {
  n: number;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-7">
      <div className="mb-3 flex items-center gap-3">
        <span className="bg-accent text-accent-ink text-small flex size-7 shrink-0 items-center justify-center rounded-full font-semibold">
          {n}
        </span>
        <h2 className="flex-1 text-[1.0625rem] font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function BookingForm({
  clinic,
  doctor,
  slot,
  onSlot,
  reschedule,
  onBack,
  onChangeDoctor,
  onBooked,
}: {
  clinic: ClinicInfo;
  doctor: Doctor;
  slot?: Slot;
  onSlot: (slot: Slot | undefined) => void;
  reschedule?: PatientBooking;
  onBack: () => void;
  onChangeDoctor: () => void;
  onBooked: (booking: PatientBooking) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  const [refresh, setRefresh] = useState(0);

  async function submit() {
    if (busy || !slot) return;
    setBusy(true);
    setError(undefined);
    const body = { doctorId: doctor.id, ...slot };
    try {
      const booking = reschedule
        ? await api<PatientBooking>(`bookings/${reschedule.id}`, {
            method: "PATCH",
            body: { action: "reschedule", ...body },
          })
        : await api<PatientBooking>("bookings", { method: "POST", body });
      onBooked(booking);
    } catch (e) {
      const err =
        e instanceof ApiError
          ? e
          : new ApiError("Не удалось записаться.", 0, "server");
      setError(err);
      // Время заняли или оно больше недоступно — обновляем свободные слоты.
      if (["taken", "unavailable"].includes(err.code)) {
        onSlot(undefined);
        setRefresh((r) => r + 1);
      }
      setBusy(false);
    }
  }

  return (
    <div className="miniapp-screen flex min-h-dvh flex-col">
      <TopBar
        title={reschedule ? "Перенос записи" : "Запись на приём"}
        onBack={onBack}
      />
      <main className="mx-auto w-full max-w-xl flex-1 px-5 pt-3 pb-[calc(7rem+env(safe-area-inset-bottom))]">
        <Step
          n={1}
          title="Врач"
          action={
            <button
              type="button"
              onClick={onChangeDoctor}
              className="text-small text-accent font-semibold"
            >
              Изменить
            </button>
          }
        >
          <Card className="flex items-center gap-3.5 p-3.5">
            <DoctorPortrait
              name={doctor.name}
              specialtyId={doctor.specialtyId}
              photoUrl={doctor.photoUrl}
            />
            <div className="min-w-0">
              <p className="leading-snug font-semibold">{doctor.name}</p>
              <p className="text-small text-accent">{doctor.specialty}</p>
              <p className="text-caption text-muted mt-0.5">
                Приём {doctor.slotMinutes} мин
                {doctor.priceRub !== null && ` · ${rub(doctor.priceRub)}`}
              </p>
            </div>
          </Card>
        </Step>

        <Step n={2} title="Дата и время">
          <SlotPicker
            key={refresh}
            doctor={doctor}
            today={clinic.today}
            value={slot}
            onChange={(s) => {
              setError(undefined);
              onSlot(s);
            }}
          />
        </Step>

        {error && (
          <div className="mb-6">
            <ErrorState
              error={
                ["taken", "unavailable"].includes(error.code)
                  ? `${error.message} Свободное время обновлено.`
                  : error
              }
            />
          </div>
        )}

        {slot && (
          <Step n={3} title="Проверьте запись">
            <Card className="p-4">
              <dl className="flex flex-col gap-3.5">
                <Row icon="calendar" label="Дата и время">
                  {longDay(slot.date, clinic.today)}, {slot.time}
                </Row>
                <Row icon="clock" label="Длительность">
                  {doctor.slotMinutes} минут
                </Row>
                {doctor.priceRub !== null && (
                  <Row icon="ruble" label="Стоимость приёма">
                    {rub(doctor.priceRub)}
                  </Row>
                )}
                <Row icon="pin" label="Адрес">
                  {clinic.address}
                </Row>
                {reschedule && (
                  <Row icon="swap" label="Вместо">
                    {longDay(reschedule.date, clinic.today)}, {reschedule.time}{" "}
                    — {reschedule.doctorName}
                  </Row>
                )}
              </dl>
            </Card>
            <p className="text-caption text-muted mt-3">
              Демо: клиника и расписание вымышленные, запись тестовая. Отменить
              или перенести её можно в разделе «Записи».
            </p>
          </Step>
        )}
      </main>
      <StickyFooter>
        <Button size="lg" block onClick={submit} disabled={!slot || busy}>
          {busy
            ? "Записываем…"
            : !slot
              ? "Выберите время"
              : reschedule
                ? "Перенести запись"
                : "Подтвердить запись"}
        </Button>
      </StickyFooter>
    </div>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: Parameters<typeof MaIcon>[0]["name"];
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <MaIcon name={icon} size={20} className="text-accent mt-0.5 shrink-0" />
      <div className="min-w-0">
        <dt className="text-caption text-muted">{label}</dt>
        <dd className="font-medium break-words">{children}</dd>
      </div>
    </div>
  );
}

/**
 * Выбор дня и времени по реальному расписанию врача (правила пациента).
 * Общий для записи и карточки врача.
 */
export function SlotPicker({
  doctor,
  today,
  value,
  onChange,
}: {
  doctor: Doctor;
  today: string;
  value?: Slot;
  onChange: (slot: Slot) => void;
}) {
  const id = encodeURIComponent(doctor.id);
  const days = useApi<string[]>(`doctors/${id}/days`);
  const [picked, setPicked] = useState(value?.date);
  const date = picked && days.data?.includes(picked) ? picked : days.data?.[0];
  const slots = useApi<string[]>(
    date ? `doctors/${id}/slots?date=${date}` : null,
  );

  if (days.error)
    return <ErrorState error={days.error} onRetry={days.reload} />;
  if (days.loading && !days.data) return <Skeleton rows={2} height="h-12" />;
  if (days.data && days.data.length === 0)
    return (
      <EmptyState
        icon="slots"
        title="Свободного времени нет"
        text="В ближайшие две недели у врача нет свободных окон. Выберите другого врача."
      />
    );

  return (
    <div className="flex flex-col gap-4">
      <Scroller label="Дата">
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
                "rounded-card flex w-[4.75rem] shrink-0 flex-col items-center py-3 transition-colors",
                active
                  ? "bg-accent text-accent-ink shadow-card"
                  : "bg-surface text-ink shadow-card",
              )}
            >
              <span
                className={cn(
                  "text-caption font-medium",
                  active ? "" : "text-muted",
                )}
              >
                {dayName(d, today)}
              </span>
              <span className="mt-0.5 text-[1.375rem] leading-tight font-semibold">
                {chip.day}
              </span>
              <span className={cn("text-caption", active ? "" : "text-muted")}>
                {chip.month}
              </span>
            </button>
          );
        })}
      </Scroller>
      {date &&
        (slots.error ? (
          <ErrorState error={slots.error} onRetry={slots.reload} />
        ) : slots.loading ? (
          <Skeleton rows={2} height="h-12" />
        ) : slots.data && slots.data.length === 0 ? (
          <p className="text-small text-muted">
            На этот день время уже разобрали. Выберите другой день.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2.5 min-[400px]:grid-cols-4">
            {slots.data?.map((t) => {
              const active = value?.date === date && value.time === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => onChange({ date, time: t })}
                  aria-pressed={active}
                  className={cn(
                    "rounded-field h-12 font-semibold transition-colors",
                    active
                      ? "bg-accent text-accent-ink shadow-cta"
                      : "bg-surface text-ink shadow-card",
                  )}
                >
                  {t}
                </button>
              );
            })}
          </div>
        ))}
    </div>
  );
}

/* Готово */

function Success({
  clinic,
  booking,
  rescheduled,
  onShowBookings,
  onHome,
}: {
  clinic: ClinicInfo;
  booking: PatientBooking;
  rescheduled: boolean;
  onShowBookings: () => void;
  onHome: () => void;
}) {
  return (
    <main className="miniapp-screen mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5 pt-[calc(3rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="miniapp-pop bg-accent text-accent-ink shadow-cta flex size-20 items-center justify-center rounded-full">
          <MaIcon name="check" size={38} strokeWidth={2} />
        </span>
        <h1 className="font-display mt-2 text-[1.75rem] leading-tight font-semibold">
          {rescheduled ? "Запись перенесена" : "Вы записаны"}
        </h1>
        <p className="text-muted">
          Запись №{booking.id} · {longDay(booking.date, clinic.today)},{" "}
          {booking.time}
        </p>
      </div>
      <Card raised className="mt-7 p-4">
        <div className="flex items-center gap-3.5">
          <DoctorPortrait
            name={booking.doctorName}
            photoUrl={booking.doctorPhotoUrl}
          />
          <div className="min-w-0">
            <p className="leading-snug font-semibold">{booking.doctorName}</p>
            <p className="text-small text-accent">{booking.specialty}</p>
          </div>
        </div>
        <div className="border-border text-small mt-4 flex flex-col gap-2 border-t pt-4">
          <p className="flex gap-2.5">
            <MaIcon name="pin" size={18} className="text-accent shrink-0" />
            {clinic.address}
          </p>
          {booking.priceRub !== null && (
            <p className="flex gap-2.5">
              <MaIcon name="ruble" size={18} className="text-accent shrink-0" />
              Стоимость приёма: {rub(booking.priceRub)}
            </p>
          )}
        </div>
      </Card>
      {clinic.visitTips.length > 0 && (
        <Card className="mt-3 p-4">
          <p className="mb-2 font-semibold">Перед визитом</p>
          <ul className="text-small text-muted flex list-disc flex-col gap-1 pl-5">
            {clinic.visitTips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </Card>
      )}
      <div className="mt-auto flex flex-col gap-2.5 pt-8">
        <Button size="lg" block onClick={onShowBookings}>
          Мои записи
        </Button>
        <Button size="lg" variant="secondary" block onClick={onHome}>
          На главную
        </Button>
      </div>
    </main>
  );
}
