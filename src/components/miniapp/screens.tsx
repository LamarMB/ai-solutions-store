"use client";

import { useState } from "react";
import {
  AiPhotoNote,
  DoctorPortrait,
  HeroArt,
  Logo,
} from "@/components/miniapp/art";
import {
  api,
  ApiError,
  longDay,
  rub,
  type ClinicInfo,
  type PatientBooking,
} from "@/components/miniapp/client";
import {
  MaIcon,
  specialtyIcon,
  type MaIconName,
} from "@/components/miniapp/icons";
import type { ScreenProps } from "@/components/miniapp/MiniApp";
import {
  Button,
  Card,
  CardButton,
  Chip,
  DemoTag,
  EmptyState,
  ErrorState,
  InfoRow,
  LinkButton,
  Scroller,
  ScreenTitle,
  SectionTitle,
  Segmented,
  Sheet,
  Skeleton,
  StatusBadge,
} from "@/components/miniapp/ui";
import { cn } from "@/lib/cn";

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

/* Главная */

/** Преимущества — то, что действительно делает приложение, без обещаний о клинике. */
const FEATURES: { icon: MaIconName; title: string }[] = [
  { icon: "slots", title: "Только свободное время" },
  { icon: "swap", title: "Перенос и отмена онлайн" },
  { icon: "ruble", title: "Цены заранее" },
];

export function HomeScreen({
  clinic,
  bookings,
  openFlow,
  openDoctor,
  goTo,
}: ScreenProps) {
  const next = bookings.data?.upcoming[0];
  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <Logo />
        <DemoTag />
      </div>

      <section className="bg-hero rounded-panel relative overflow-hidden px-5 pt-6 pb-5">
        <HeroArt className="pointer-events-none absolute -right-6 -bottom-2 h-[78%] w-auto opacity-95" />
        <div className="relative max-w-[68%]">
          <h1 className="font-display text-[1.75rem] leading-[1.12] font-semibold min-[400px]:text-[1.95rem]">
            Забота о вашем здоровье каждый день
          </h1>
          <p className="text-small text-muted mt-3">
            Запись к врачу онлайн — врачи, цены и свободное время.
          </p>
        </div>
        <div className="relative mt-6">
          <Button size="lg" block onClick={() => openFlow()}>
            Записаться на приём
          </Button>
        </div>
      </section>

      <ul className="mt-4 grid grid-cols-3 gap-2.5">
        {FEATURES.map((f) => (
          <Card
            as="li"
            key={f.title}
            className="flex flex-col items-center gap-2 px-2 py-3.5 text-center"
          >
            <span className="bg-accent-soft text-accent flex size-10 items-center justify-center rounded-full">
              <MaIcon name={f.icon} size={20} />
            </span>
            <span className="text-caption leading-snug font-medium">
              {f.title}
            </span>
          </Card>
        ))}
      </ul>

      {(bookings.loading || bookings.error || next) && (
        <>
          <SectionTitle
            action={
              next ? (
                <LinkButton onClick={() => goTo("bookings")}>Все</LinkButton>
              ) : undefined
            }
          >
            Ближайшая запись
          </SectionTitle>
          {bookings.error ? (
            <ErrorState error={bookings.error} onRetry={bookings.reload} />
          ) : !bookings.data ? (
            <Skeleton rows={1} />
          ) : (
            next && (
              <CardButton onClick={() => goTo("bookings")}>
                <span className="bg-accent text-accent-ink rounded-field flex size-16 shrink-0 flex-col items-center justify-center leading-tight">
                  <span className="text-caption">
                    {longDay(next.date, clinic.today).split(",")[0]}
                  </span>
                  <span className="font-semibold">{next.time}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{next.doctorName}</span>
                  <span className="text-small text-muted block">
                    {next.specialty} · {longDay(next.date, clinic.today)}
                  </span>
                </span>
                <MaIcon name="chevron" size={20} className="text-muted" />
              </CardButton>
            )
          )}
        </>
      )}

      <SectionTitle
        action={<LinkButton onClick={() => goTo("doctors")}>Все</LinkButton>}
      >
        Наши врачи
      </SectionTitle>
      <Scroller>
        {clinic.doctors.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => openDoctor(d.id)}
            className="bg-surface rounded-card shadow-card flex w-40 shrink-0 flex-col items-start gap-2.5 p-2.5 pb-3.5 text-left"
          >
            <DoctorPortrait
              name={d.name}
              specialtyId={d.specialtyId}
              photoUrl={d.photoUrl}
              size="tile"
            />
            <span className="min-w-0 px-1">
              <span className="text-small line-clamp-2 block leading-snug font-semibold">
                {d.name}
              </span>
              <span className="text-caption text-accent block">
                {d.specialty}
              </span>
            </span>
          </button>
        ))}
      </Scroller>
      {clinic.doctors.some((d) => d.photoIsDemo) && (
        <AiPhotoNote className="-mt-1" />
      )}

      <SectionTitle
        action={<LinkButton onClick={() => goTo("services")}>Все</LinkButton>}
      >
        Популярные услуги
      </SectionTitle>
      {clinic.services.length === 0 ? (
        <Card className="p-4">
          <p className="text-small text-muted">
            Список услуг пока не заполнен.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {clinic.services.slice(0, 3).map((s) => (
            <li key={s.title}>
              <ServiceRow
                service={s}
                onBook={
                  s.specialtyId
                    ? () =>
                        openFlow({ specialtyId: s.specialtyId ?? undefined })
                    : undefined
                }
              />
            </li>
          ))}
        </ul>
      )}

      <SectionTitle
        action={
          <LinkButton onClick={() => goTo("about")}>Подробнее</LinkButton>
        }
      >
        Контакты
      </SectionTitle>
      <Contacts clinic={clinic} />
    </>
  );
}

function Contacts({ clinic }: { clinic: ClinicInfo }) {
  return (
    <Card className="divide-border divide-y px-4 py-1">
      <InfoRow icon="pin" label="Адрес">
        {clinic.address}
      </InfoRow>
      {clinic.phone && (
        <InfoRow icon="phone" label="Телефон">
          <a href={telHref(clinic.phone)} className="text-accent font-semibold">
            {clinic.phone}
          </a>
        </InfoRow>
      )}
      <InfoRow icon="clock" label="Режим работы">
        {clinic.workingHours}
      </InfoRow>
    </Card>
  );
}

/* Врачи */

export function DoctorsScreen({ clinic, openDoctor }: ScreenProps) {
  const [filter, setFilter] = useState("all");
  const doctors = clinic.doctors.filter(
    (d) => filter === "all" || d.specialtyId === filter,
  );
  return (
    <>
      <ScreenTitle subtitle="Выберите специалиста, чтобы посмотреть свободное время">
        Наши врачи
      </ScreenTitle>
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
        <EmptyState icon="doctors" title="Врачей с такой специальностью нет" />
      ) : (
        <ul className="flex flex-col gap-3">
          {doctors.map((d) => (
            <li key={d.id}>
              <CardButton
                onClick={() => openDoctor(d.id)}
                className="items-start p-4"
              >
                <DoctorPortrait
                  name={d.name}
                  specialtyId={d.specialtyId}
                  photoUrl={d.photoUrl}
                />
                <span className="min-w-0 flex-1">
                  <span className="block leading-snug font-semibold break-words">
                    {d.name}
                  </span>
                  <span className="text-small text-accent block font-medium">
                    {d.specialty}
                  </span>
                  <span className="text-caption text-muted mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    <span>
                      {d.priceRub !== null
                        ? rub(d.priceRub)
                        : "Цена — уточняйте"}
                    </span>
                    <span>{d.slotMinutes} мин</span>
                  </span>
                  <span
                    className={cn(
                      "text-caption mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium",
                      d.nearest
                        ? "bg-accent-soft text-accent"
                        : "bg-surface-2 text-muted",
                    )}
                  >
                    <MaIcon name="clock" size={14} />
                    {d.nearest
                      ? `${longDay(d.nearest.date, clinic.today).split(",")[0]}, ${d.nearest.time}`
                      : "Нет свободного времени"}
                  </span>
                </span>
                <MaIcon name="chevron" size={20} className="text-muted mt-1" />
              </CardButton>
            </li>
          ))}
        </ul>
      )}
      {clinic.doctors.some((d) => d.photoIsDemo) && (
        <AiPhotoNote className="mt-5 text-center" />
      )}
    </>
  );
}

/* Услуги */

function ServiceRow({
  service,
  onBook,
}: {
  service: ClinicInfo["services"][number];
  onBook?: () => void;
}) {
  const body = (
    <>
      <span className="bg-hero text-accent flex size-12 shrink-0 items-center justify-center rounded-[14px]">
        <MaIcon name={specialtyIcon(service.specialtyId)} size={24} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 block leading-snug font-medium break-words">
          {service.title}
        </span>
        <span className="text-accent mt-0.5 block font-semibold">
          {rub(service.priceRub)}
        </span>
      </span>
    </>
  );
  return onBook ? (
    <CardButton onClick={onBook} aria-label={`${service.title}: записаться`}>
      {body}
      <MaIcon name="chevron" size={20} className="text-muted" />
    </CardButton>
  ) : (
    <Card className="flex items-center gap-3 p-3.5">{body}</Card>
  );
}

const norm = (s: string) => s.toLowerCase().replaceAll("ё", "е");

export function ServicesScreen({ clinic, openFlow }: ScreenProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const categories = clinic.specialties.filter((sp) =>
    clinic.services.some((s) => s.specialtyId === sp.id),
  );
  const words = norm(query).split(/\s+/).filter(Boolean);
  const services = clinic.services.filter(
    (s) =>
      (filter === "all" || s.specialtyId === filter) &&
      words.every((w) => norm(`${s.title} ${s.specialty ?? ""}`).includes(w)),
  );
  return (
    <>
      <ScreenTitle subtitle="Цены из прайса клиники. Нажмите на услугу, чтобы записаться к врачу этого направления.">
        Услуги и цены
      </ScreenTitle>
      <label className="bg-surface rounded-control shadow-card mb-3 flex h-12 items-center gap-2.5 px-4">
        <MaIcon name="search" size={20} className="text-muted shrink-0" />
        <span className="sr-only">Поиск услуги</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск услуги"
          enterKeyHint="search"
          className="text-body placeholder:text-muted min-w-0 flex-1 bg-transparent outline-none"
        />
      </label>
      {categories.length > 1 && (
        <Scroller label="Категория">
          <Chip active={filter === "all"} onClick={() => setFilter("all")}>
            Все
          </Chip>
          {categories.map((c) => (
            <Chip
              key={c.id}
              active={filter === c.id}
              onClick={() => setFilter(c.id)}
            >
              {c.title}
            </Chip>
          ))}
        </Scroller>
      )}
      {clinic.services.length === 0 ? (
        <EmptyState icon="services" title="Список услуг пока не заполнен" />
      ) : services.length === 0 ? (
        <EmptyState
          icon="search"
          title="Ничего не найдено"
          text="Попробуйте другое слово или категорию."
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {services.map((s) => (
            <li key={s.title}>
              <ServiceRow
                service={s}
                onBook={
                  s.specialtyId
                    ? () =>
                        openFlow({ specialtyId: s.specialtyId ?? undefined })
                    : undefined
                }
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* Мои записи */

function BookingCard({
  booking,
  today,
  address,
  featured,
  onReschedule,
  onCancel,
}: {
  booking: PatientBooking;
  today: string;
  address: string;
  featured?: boolean;
  onReschedule: () => void;
  onCancel: () => void;
}) {
  return (
    <Card
      as="li"
      raised={featured}
      className={cn(
        "flex flex-col gap-4 p-4",
        featured && "border-accent border-l-4",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-small text-muted">
            {longDay(booking.date, today)}
          </p>
          <p
            className={cn(
              "font-semibold",
              featured
                ? "text-accent text-[1.75rem] leading-tight"
                : "text-[1.25rem]",
            )}
          >
            {booking.time}
          </p>
        </div>
        <StatusBadge booking={booking} />
      </div>
      <div className="flex items-center gap-3">
        <DoctorPortrait
          name={booking.doctorName}
          photoUrl={booking.doctorPhotoUrl}
          size="sm"
        />
        <div className="min-w-0">
          <p className="leading-snug font-semibold break-words">
            {booking.doctorName}
          </p>
          <p className="text-small text-muted">
            {booking.specialty}
            {booking.priceRub !== null && ` · ${rub(booking.priceRub)}`}
          </p>
        </div>
      </div>
      {featured && (
        <p className="text-small text-muted flex gap-2">
          <MaIcon name="pin" size={18} className="text-accent shrink-0" />
          {address}
        </p>
      )}
      <p className="text-caption text-muted">Запись №{booking.id}</p>
      {booking.upcoming && (
        <div className="grid grid-cols-2 gap-2.5">
          <Button size="sm" variant="secondary" onClick={onReschedule}>
            Перенести
          </Button>
          <Button size="sm" variant="danger" onClick={onCancel}>
            Отменить
          </Button>
        </div>
      )}
    </Card>
  );
}

export function MyBookingsScreen({
  clinic,
  bookings,
  openFlow,
  reloadClinic,
}: ScreenProps) {
  const [view, setView] = useState<"upcoming" | "past">("upcoming");
  const [cancelling, setCancelling] = useState<PatientBooking>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  const [notice, setNotice] = useState<string>();

  async function cancel() {
    if (!cancelling || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api(`bookings/${cancelling.id}`, {
        method: "PATCH",
        body: { action: "cancel" },
      });
      setNotice(`Запись №${cancelling.id} отменена, время освободилось.`);
      setCancelling(undefined);
      bookings.reload();
      reloadClinic();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e
          : new ApiError("Не удалось отменить.", 0, "server"),
      );
    } finally {
      setBusy(false);
    }
  }

  const list = bookings.data?.[view] ?? [];
  const count = (id: "upcoming" | "past") =>
    bookings.data ? ` · ${bookings.data[id].length}` : "";
  return (
    <>
      <ScreenTitle>Мои записи</ScreenTitle>
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { id: "upcoming", label: `Предстоящие${count("upcoming")}` },
          { id: "past", label: `Прошедшие${count("past")}` },
        ]}
      />
      {notice && (
        <p
          role="status"
          className="bg-accent-soft text-accent rounded-field text-small mb-4 px-4 py-3 font-medium"
        >
          {notice}
        </p>
      )}
      {bookings.error ? (
        <ErrorState error={bookings.error} onRetry={bookings.reload} />
      ) : bookings.loading && !bookings.data ? (
        <Skeleton rows={2} height="h-28" />
      ) : list.length === 0 ? (
        <EmptyState
          title={
            view === "upcoming"
              ? "Предстоящих записей нет"
              : "Прошедших записей нет"
          }
          text={
            view === "upcoming"
              ? "Запишитесь к врачу — запись появится здесь и в сообщениях бота."
              : undefined
          }
          action={
            view === "upcoming" ? (
              <Button onClick={() => openFlow()}>Записаться на приём</Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((b, i) => (
            <BookingCard
              key={b.id}
              booking={b}
              today={clinic.today}
              address={clinic.address}
              featured={view === "upcoming" && i === 0}
              onReschedule={() => openFlow({ reschedule: b })}
              onCancel={() => {
                setError(undefined);
                setNotice(undefined);
                setCancelling(b);
              }}
            />
          ))}
        </ul>
      )}
      <Sheet
        open={cancelling !== undefined}
        title="Отменить запись?"
        onClose={() => setCancelling(undefined)}
      >
        {cancelling && (
          <div className="flex flex-col gap-4">
            <p className="text-muted">
              {cancelling.doctorName},{" "}
              {longDay(cancelling.date, clinic.today).toLowerCase()},{" "}
              {cancelling.time}. Время освободится для других пациентов.
            </p>
            {error && <ErrorState error={error} />}
            <div className="flex flex-col gap-2.5">
              <Button
                size="lg"
                block
                variant="danger"
                onClick={cancel}
                disabled={busy}
              >
                {busy ? "Отменяем…" : "Да, отменить запись"}
              </Button>
              <Button
                size="lg"
                block
                variant="secondary"
                onClick={() => setCancelling(undefined)}
                disabled={busy}
              >
                Не отменять
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}

/* О клинике */

export function AboutScreen({ clinic }: ScreenProps) {
  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <Logo />
        <DemoTag />
      </div>
      <ScreenTitle>О клинике</ScreenTitle>
      {clinic.about && (
        <Card className="mb-3 p-4">
          <p className="text-small whitespace-pre-line">{clinic.about}</p>
        </Card>
      )}
      <Contacts clinic={clinic} />
      {clinic.route && (
        <>
          <SectionTitle>Как добраться</SectionTitle>
          <Card className="p-4">
            <p className="text-small whitespace-pre-line">{clinic.route}</p>
          </Card>
        </>
      )}
      <SectionTitle>Вопросы и консультация</SectionTitle>
      <Card className="flex flex-col gap-3 p-4">
        <p className="text-small text-muted">
          Ответить на вопросы и подобрать специалиста поможет бот клиники в
          сообщениях сообщества ВКонтакте.
        </p>
        <p className="text-small text-muted">
          Важно: переписку в сообщениях сообщества могут читать администраторы
          сообщества ВКонтакте. Не пишите подробностей о здоровье, которые не
          готовы им показать.
        </p>
        {clinic.messagesUrl ? (
          <a
            href={clinic.messagesUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-accent text-accent-ink rounded-control shadow-cta flex h-12 items-center justify-center gap-2 font-semibold"
          >
            <MaIcon name="chat" size={20} />
            Написать в сообщения сообщества
          </a>
        ) : (
          <p className="text-small text-muted">
            Ссылка на сообщество не настроена.
          </p>
        )}
      </Card>
    </>
  );
}
