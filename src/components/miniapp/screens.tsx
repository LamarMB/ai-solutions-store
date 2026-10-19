"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  api,
  ApiError,
  formatDay,
  relativeDay,
  rub,
  type PatientBooking,
} from "@/components/miniapp/client";
import { Avatar } from "@/components/miniapp/BookingFlow";
import type { ScreenProps } from "@/components/miniapp/MiniApp";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  InfoRow,
  LinkButton,
  SectionTitle,
  Sheet,
  Skeleton,
  StatusBadge,
} from "@/components/miniapp/ui";
import { cn } from "@/lib/cn";

function DemoNote() {
  return (
    <p className="bg-demo-bg text-demo-ink rounded-field text-caption px-3 py-2 font-medium">
      Демо: клиника, врачи и расписание вымышленные, запись тестовая.
    </p>
  );
}

/* Главная */

export function HomeScreen({ clinic, bookings, openFlow, goTo }: ScreenProps) {
  const next = bookings.data?.upcoming[0];
  return (
    <>
      <header className="mb-4 flex flex-col gap-3">
        <DemoNote />
        <div>
          <p className="text-small text-muted">Медицинская клиника</p>
          <h1 className="text-h2 font-semibold">{clinic.name}</h1>
          {clinic.about && (
            <p className="text-small text-muted mt-1 line-clamp-3">
              {clinic.about}
            </p>
          )}
        </div>
      </header>

      <Button block onClick={() => openFlow()}>
        <Icon name="calendar" size={20} />
        Записаться к врачу
      </Button>

      <SectionTitle
        action={
          next ? (
            <LinkButton onClick={() => goTo("bookings")}>Все записи</LinkButton>
          ) : undefined
        }
      >
        Ближайшая запись
      </SectionTitle>
      {bookings.error ? (
        <ErrorState error={bookings.error} onRetry={bookings.reload} />
      ) : bookings.loading && !bookings.data ? (
        <Skeleton rows={1} />
      ) : next ? (
        <Card className="flex items-center gap-3">
          <span className="bg-accent text-accent-ink rounded-field flex size-14 shrink-0 flex-col items-center justify-center leading-tight">
            <span className="text-caption">
              {relativeDay(next.date, clinic.today).split(",")[0]}
            </span>
            <span className="font-semibold">{next.time}</span>
          </span>
          <div className="min-w-0">
            <p className="font-semibold">{next.doctorName}</p>
            <p className="text-small text-muted">
              {next.specialty} · {formatDay(next.date)}
            </p>
          </div>
        </Card>
      ) : (
        <Card>
          <p className="text-small text-muted">
            У вас пока нет предстоящих записей.
          </p>
        </Card>
      )}

      <SectionTitle
        action={<LinkButton onClick={() => goTo("services")}>Все</LinkButton>}
      >
        Популярные услуги
      </SectionTitle>
      {clinic.services.length === 0 ? (
        <Card>
          <p className="text-small text-muted">
            Список услуг пока не заполнен.
          </p>
        </Card>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {clinic.services.slice(0, 4).map((s) => (
            <Card as="li" key={s.title} className="flex flex-col gap-1">
              <span className="text-small leading-snug font-medium">
                {s.title}
              </span>
              <span className="text-accent mt-auto font-semibold">
                {rub(s.priceRub)}
              </span>
            </Card>
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
      <Card className="py-1.5">
        <InfoRow icon="pin" label="Адрес">
          {clinic.address}
        </InfoRow>
        {clinic.phone && (
          <InfoRow icon="phone" label="Телефон">
            <a
              href={`tel:${clinic.phone.replace(/[^\d+]/g, "")}`}
              className="text-accent font-medium"
            >
              {clinic.phone}
            </a>
          </InfoRow>
        )}
        <InfoRow icon="clock" label="Режим работы">
          {clinic.workingHours}
        </InfoRow>
      </Card>
    </>
  );
}

/* Врачи */

export function DoctorsScreen({ clinic, openFlow }: ScreenProps) {
  const [filter, setFilter] = useState<string>("all");
  const doctors = clinic.doctors.filter(
    (d) => filter === "all" || d.specialtyId === filter,
  );
  return (
    <>
      <h1 className="text-h2 mb-3 font-semibold">Врачи</h1>
      <div
        className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1"
        role="group"
        aria-label="Специальность"
      >
        {[{ id: "all", title: "Все" }, ...clinic.specialties].map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setFilter(s.id)}
            aria-pressed={filter === s.id}
            className={cn(
              "rounded-control text-small h-9 shrink-0 border px-4 font-medium transition-colors",
              filter === s.id
                ? "border-accent bg-accent text-accent-ink"
                : "border-border bg-surface text-ink",
            )}
          >
            {s.title}
          </button>
        ))}
      </div>
      {doctors.length === 0 ? (
        <EmptyState icon="users" title="Врачей с такой специальностью нет" />
      ) : (
        <ul className="flex flex-col gap-3">
          {doctors.map((d) => (
            <Card as="li" key={d.id} className="flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <Avatar name={d.name} />
                <div className="min-w-0">
                  <p className="font-semibold">{d.name}</p>
                  <p className="text-small text-accent font-medium">
                    {d.specialty}
                  </p>
                </div>
              </div>
              {d.about && <p className="text-small text-muted">{d.about}</p>}
              <div className="text-small flex flex-wrap gap-x-4 gap-y-1">
                <span>
                  <span className="text-muted">Приём: </span>
                  {d.slotMinutes} мин
                </span>
                <span>
                  <span className="text-muted">Стоимость: </span>
                  {d.priceRub !== null
                    ? rub(d.priceRub)
                    : "уточняйте в клинике"}
                </span>
              </div>
              <div className="bg-surface-2 rounded-field text-small flex items-center gap-2 px-3 py-2">
                <Icon name="clock" size={16} />
                {d.nearest
                  ? `Ближайшее время: ${relativeDay(d.nearest.date, clinic.today)}, ${d.nearest.time}`
                  : "Нет свободного времени в ближайшие две недели"}
              </div>
              <Button
                block
                disabled={!d.nearest}
                onClick={() => openFlow({ doctorId: d.id })}
              >
                Записаться
              </Button>
            </Card>
          ))}
        </ul>
      )}
    </>
  );
}

/* Мои записи */

export function MyBookingsScreen({
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
  return (
    <>
      <h1 className="text-h2 mb-3 font-semibold">Мои записи</h1>
      <div
        className="bg-surface-2 rounded-control mb-4 grid grid-cols-2 p-1"
        role="tablist"
      >
        {(
          [
            ["upcoming", "Предстоящие"],
            ["past", "Прошедшие"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            className={cn(
              "rounded-control text-small h-9 font-medium transition-colors",
              view === id ? "bg-surface text-ink shadow-sm" : "text-muted",
            )}
          >
            {label}
            {bookings.data && ` · ${bookings.data[id].length}`}
          </button>
        ))}
      </div>
      {notice && (
        <p
          role="status"
          className="bg-accent-soft text-accent rounded-field text-small mb-3 px-3 py-2 font-medium"
        >
          {notice}
        </p>
      )}
      {bookings.error ? (
        <ErrorState error={bookings.error} onRetry={bookings.reload} />
      ) : bookings.loading && !bookings.data ? (
        <Skeleton rows={3} />
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
              <Button small onClick={() => openFlow()}>
                Записаться
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((b) => (
            <Card as="li" key={b.id} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {formatDay(b.date)}, {b.time}
                  </p>
                  <p className="text-small text-muted">Запись №{b.id}</p>
                </div>
                <StatusBadge booking={b} />
              </div>
              <div className="flex items-center gap-3">
                <Avatar name={b.doctorName} />
                <div className="min-w-0">
                  <p className="font-medium">{b.doctorName}</p>
                  <p className="text-small text-muted">
                    {b.specialty}
                    {b.priceRub !== null && ` · ${rub(b.priceRub)}`}
                  </p>
                </div>
              </div>
              {b.upcoming && (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    small
                    variant="secondary"
                    onClick={() => openFlow({ reschedule: b })}
                  >
                    Перенести
                  </Button>
                  <Button
                    small
                    variant="danger"
                    onClick={() => {
                      setError(undefined);
                      setNotice(undefined);
                      setCancelling(b);
                    }}
                  >
                    Отменить
                  </Button>
                </div>
              )}
            </Card>
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
              {cancelling.doctorName}, {formatDay(cancelling.date)},{" "}
              {cancelling.time}. Время освободится для других пациентов.
            </p>
            {error && <ErrorState error={error} />}
            <div className="flex flex-col gap-2">
              <Button block variant="danger" onClick={cancel} disabled={busy}>
                {busy ? "Отменяем…" : "Да, отменить запись"}
              </Button>
              <Button
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

/* Услуги */

export function ServicesScreen({ clinic, openFlow }: ScreenProps) {
  return (
    <>
      <h1 className="text-h2 mb-1 font-semibold">Услуги и цены</h1>
      <p className="text-small text-muted mb-4">
        Цены из прайса клиники; актуальную стоимость приёма врача видно при
        записи.
      </p>
      {clinic.services.length === 0 ? (
        <EmptyState icon="document" title="Список услуг пока не заполнен" />
      ) : (
        <Card className="py-1">
          <ul className="divide-border divide-y">
            {clinic.services.map((s) => (
              <li
                key={s.title}
                className="flex items-start justify-between gap-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium">{s.title}</p>
                  {s.specialty && (
                    <p className="text-small text-muted">{s.specialty}</p>
                  )}
                </div>
                <span className="font-semibold whitespace-nowrap">
                  {rub(s.priceRub)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="mt-4">
        <Button block onClick={() => openFlow()}>
          Записаться к врачу
        </Button>
      </div>
    </>
  );
}

/* О клинике */

export function AboutScreen({ clinic }: ScreenProps) {
  return (
    <>
      <h1 className="text-h2 mb-3 font-semibold">О клинике</h1>
      {clinic.about && (
        <Card className="mb-3">
          <p className="text-small whitespace-pre-line">{clinic.about}</p>
        </Card>
      )}
      <Card className="py-1.5">
        <InfoRow icon="pin" label="Адрес">
          {clinic.address}
        </InfoRow>
        {clinic.phone && (
          <InfoRow icon="phone" label="Телефон">
            <a
              href={`tel:${clinic.phone.replace(/[^\d+]/g, "")}`}
              className="text-accent font-medium"
            >
              {clinic.phone}
            </a>
          </InfoRow>
        )}
        <InfoRow icon="clock" label="Часы работы">
          {clinic.workingHours}
        </InfoRow>
      </Card>
      {clinic.route && (
        <>
          <SectionTitle>Как добраться</SectionTitle>
          <Card>
            <p className="text-small whitespace-pre-line">{clinic.route}</p>
          </Card>
        </>
      )}
      <SectionTitle>Вопросы и консультация</SectionTitle>
      <Card className="flex flex-col gap-3">
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
            className="liquid-primary rounded-control flex h-12 items-center justify-center gap-2 font-semibold"
          >
            <Icon name="chat" size={20} />
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
