"use client";

import Link from "next/link";
import type { AdminService, BookingView } from "@/admin/service";
import { useResource } from "@/components/admin/client";
import {
  formatDate,
  formatMoment,
  SOURCE_LABELS,
} from "@/components/admin/format";
import {
  EmptyState,
  ErrorNote,
  Loading,
  PageHeader,
  Panel,
  StatusBadge,
} from "@/components/admin/ui";
import { ButtonLink } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

type DashboardData = ReturnType<AdminService["dashboard"]>;

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="border-border bg-surface rounded-card border p-4">
      <p className="text-small text-muted">{label}</p>
      <p className="text-h2 mt-1 font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-caption text-muted mt-1">{hint}</p>}
    </div>
  );
}

function BookingRow({
  booking,
  showDate,
}: {
  booking: BookingView;
  showDate?: boolean;
}) {
  return (
    <li className="border-border flex flex-wrap items-center gap-x-4 gap-y-1 border-t py-3 first:border-t-0">
      <span className="w-28 shrink-0 font-semibold tabular-nums">
        {showDate ? `${formatDate(booking.date)}, ` : ""}
        {booking.time}
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-medium">{booking.doctorName}</span>
        <span className="text-small text-muted">
          {" "}
          · {booking.specialtyTitle}
        </span>
      </span>
      <span className="text-small text-muted">
        {SOURCE_LABELS[booking.source]}
      </span>
      <StatusBadge status={booking.status} />
    </li>
  );
}

export function Dashboard() {
  const { data, error, loading, reload } =
    useResource<DashboardData>("dashboard");

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;

  const maxMessages = Math.max(1, ...data.requests.days.map((d) => d.messages));
  const active = data.todayBookings.filter((b) => b.status !== "cancelled");

  return (
    <>
      <PageHeader
        title="Главная"
        description={`Сегодня ${formatDate(data.today)}`}
        actions={
          <ButtonLink href="/admin/bookings?new=1" size="sm">
            Записать пациента
          </ButtonLink>
        }
      />

      <div
        className={cn(
          "rounded-card mb-6 flex flex-wrap items-center gap-3 border px-4 py-3",
          data.bot.online
            ? "border-success/40 bg-success/10"
            : "border-warning/40 bg-warning/10",
        )}
        role="status"
      >
        <span
          className={cn(
            "size-2.5 rounded-full",
            data.bot.online ? "bg-success" : "bg-warning",
          )}
          aria-hidden
        />
        <span className="font-medium">
          {data.bot.online
            ? "Бот ВКонтакте работает"
            : "Бот ВКонтакте не отвечает"}
        </span>
        <span className="text-small text-muted">
          {data.bot.lastPollAt
            ? `последняя связь: ${formatMoment(data.bot.lastPollAt)}`
            : "бот ещё не запускался с этой базой"}
        </span>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Записей сегодня" value={active.length} />
        <Metric
          label="За 7 дней"
          value={data.week.confirmed + data.week.completed}
          hint={`отменено: ${data.week.cancelled}`}
        />
        <Metric label="Через бота" value={data.week.fromBot} hint="за 7 дней" />
        <Metric label="Вручную" value={data.week.fromAdmin} hint="за 7 дней" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Записи на сегодня"
          actions={
            <Link
              href="/admin/bookings"
              className="text-small text-accent hover:text-accent-hover"
            >
              Все записи
            </Link>
          }
        >
          {data.todayBookings.length === 0 ? (
            <EmptyState title="На сегодня записей нет" />
          ) : (
            <ul>
              {data.todayBookings.map((b) => (
                <BookingRow key={b.id} booking={b} />
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Ближайшие приёмы">
          {data.upcoming.length === 0 ? (
            <EmptyState
              title="Ближайших приёмов нет"
              text="Новые записи из ВКонтакте появятся здесь."
            />
          ) : (
            <ul>
              {data.upcoming.map((b) => (
                <BookingRow key={b.id} booking={b} showDate />
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Обращения в бот за 7 дней" className="lg:col-span-2">
          <div className="grid gap-6 md:grid-cols-[1fr_auto]">
            <ul
              className="flex h-40 items-end gap-2"
              aria-label="Сообщения пациентов по дням"
            >
              {data.requests.days.map((d) => (
                <li
                  key={d.day}
                  className="flex h-full flex-1 flex-col items-center justify-end gap-1"
                >
                  <span className="text-caption text-muted tabular-nums">
                    {d.messages}
                  </span>
                  <span
                    className="bg-accent w-full max-w-10 rounded-t-md"
                    style={{
                      height: `${Math.max(4, (d.messages / maxMessages) * 100)}%`,
                    }}
                  />
                  <span className="text-caption text-muted">
                    {formatDate(d.day).split(",")[0]}
                  </span>
                </li>
              ))}
            </ul>
            <dl className="text-small grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-1">
              <div>
                <dt className="text-muted">Сообщений</dt>
                <dd className="text-h3 font-semibold tabular-nums">
                  {data.requests.messages}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Запросов к ИИ</dt>
                <dd className="text-h3 font-semibold tabular-nums">
                  {data.requests.modelRequests}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Обработано без ИИ</dt>
                <dd className="text-h3 font-semibold tabular-nums">
                  {data.requests.savedRequests}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Посторонние темы</dt>
                <dd className="text-h3 font-semibold tabular-nums">
                  {data.requests.offtopic}
                </dd>
              </div>
            </dl>
          </div>
        </Panel>
      </div>
    </>
  );
}
