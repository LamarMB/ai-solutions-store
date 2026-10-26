import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { demoChats, type ChatLine } from "@/content/product-map-chats";
import { cn } from "@/lib/cn";

/**
 * Иллюстрация интерфейса продукта для первого экрана: переписка с ботом,
 * маршрут обращения, подтверждённая запись, расписание врача, записи на
 * сегодня и обращение администратору. Только функции, которые работают в
 * демо; клиника, врачи и время вымышленные (демо-стенд «Демо-Мед»), реплики
 * бота — настоящие (product-map-chats, сверяются тестом). Метрик нет.
 */

const chat: readonly ChatLine[] = demoChats.routing;
const ASK = chat[1];
const OFFER = chat[chat.length - 1];
/** Первый абзац ответа бота — без списка врачей. */
const offerText = OFFER.text.split("\n")[0];

const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

export function HeroConsole() {
  return (
    <>
      <DesktopConsole />
      <MobileConsole />
    </>
  );
}

/* ——— Широкий экран: наклонная консоль, уходит за правый край ——— */

function DesktopConsole() {
  return (
    <div aria-hidden="true" className="relative hidden lg:block">
      <div data-parallax="back">
        <div className="hc-tilt">
          <div className="hc-console flex w-[60rem] overflow-hidden">
            <Sidebar />
            <div className="min-w-0 flex-1 p-5">
              <ConsoleHeader />
              {/* Видимая часть: переписка, ядро и запись; у края — расписание. */}
              <div className="mt-4 grid grid-cols-[1.05fr_0.95fr_0.9fr] gap-3.5">
                <ChatCard className="row-span-2" />
                <CoreCard />
                <ScheduleCard />
                <BookingCard />
                <RequestCard />
                <TodayCard className="col-span-3" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Плавающие плашки перед консолью. */}
      <div data-parallax="front" className="absolute -top-5 left-[30%] z-10">
        <div className="hc-float">
          <Chip icon="shield" style={d(0)}>
            Тревожные признаки — сразу совет звонить 103 или 112
          </Chip>
        </div>
      </div>
      <div data-parallax="front" className="absolute -bottom-6 left-[14%] z-10">
        <div className="hc-float" style={{ animationDelay: "-3s" }}>
          <Chip icon="users">
            Администратору — только с разрешения пациента
          </Chip>
        </div>
      </div>
    </div>
  );
}

function Sidebar() {
  const items: { icon: IconName; active?: boolean }[] = [
    { icon: "home", active: true },
    { icon: "calendar" },
    { icon: "clock" },
    { icon: "users" },
    { icon: "chat" },
    { icon: "layers" },
  ];
  return (
    <div className="flex w-16 shrink-0 flex-col items-center gap-3 border-r border-r-[color:var(--hc-line)] py-5">
      <span className="mb-3 grid size-9 place-items-center rounded-xl bg-[rgb(62_230_163/0.12)] text-[color:var(--hc-bright)]">
        <Icon name="sparkle" size={18} />
      </span>
      {items.map((item) => (
        <span
          key={item.icon}
          className={cn(
            "grid size-9 place-items-center rounded-xl",
            item.active
              ? "bg-[rgb(62_230_163/0.1)] text-[color:var(--hc-bright)] shadow-[inset_0_0_0_1px_rgb(62_230_163/0.25)]"
              : "text-muted",
          )}
        >
          <Icon name={item.icon} size={17} />
        </span>
      ))}
    </div>
  );
}

function ConsoleHeader() {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-[0.95rem] font-semibold">Главная</p>
        <p className="text-muted text-[0.7rem]">Демо-Мед · панель клиники</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="hc-chip text-ink flex items-center gap-2 px-3 py-1.5 text-[0.7rem]">
          <span className="hc-pulse size-1.5 rounded-full bg-[var(--hc-bright)]" />
          Бот ВКонтакте работает
        </span>
        <span className="border-demo-ink/30 bg-demo-bg text-demo-ink rounded-full border px-2.5 py-1 text-[0.65rem] font-semibold">
          Демо
        </span>
      </div>
    </div>
  );
}

function CardTitle({
  icon,
  children,
  aside,
}: {
  icon: IconName;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="flex items-center gap-2 text-[0.75rem] font-semibold">
        <Icon name={icon} size={14} className="text-[color:var(--hc-bright)]" />
        {children}
      </p>
      {aside}
    </div>
  );
}

function Bubble({
  from,
  children,
  delay,
}: {
  from: "patient" | "bot";
  children: ReactNode;
  delay: number;
}) {
  return (
    <div
      className={cn(
        "hc-in flex",
        from === "patient" ? "justify-end" : "justify-start",
      )}
      style={d(delay)}
    >
      <p
        className={cn(
          "max-w-[88%] rounded-2xl px-3 py-2 text-[0.7rem] leading-snug",
          from === "patient"
            ? "rounded-br-md bg-[var(--hc-bright)] font-medium text-[#03140d]"
            : "text-ink rounded-bl-md bg-[var(--hc-card-2)] shadow-[inset_0_0_0_1px_var(--hc-line)]",
        )}
      >
        {children}
      </p>
    </div>
  );
}

function BotButtons({
  labels,
  delay,
}: {
  labels: readonly string[];
  delay: number;
}) {
  return (
    <div className="hc-in mt-1.5 flex flex-wrap gap-1" style={d(delay)}>
      {labels.map((b) => (
        <span
          key={b}
          className="text-muted rounded-full border border-[color:var(--hc-line-strong)] px-2 py-0.5 text-[0.62rem]"
        >
          {b}
        </span>
      ))}
    </div>
  );
}

function ChatCard({ className }: { className?: string }) {
  return (
    <div className={cn("hc-card flex flex-col p-4", className)}>
      <CardTitle
        icon="chat"
        aside={
          <span className="text-muted text-[0.62rem]">
            сообщения сообщества
          </span>
        }
      >
        ИИ-переписка
      </CardTitle>
      <div className="mt-3.5 flex flex-1 flex-col gap-2">
        <Bubble from="patient" delay={300}>
          {chat[0].text}
        </Bubble>
        <div>
          <Bubble from="bot" delay={800}>
            {ASK.text}
          </Bubble>
          <BotButtons labels={ASK.buttons?.slice(0, 2) ?? []} delay={1050} />
        </div>
        <p
          className="hc-in text-muted my-0.5 text-center text-[0.6rem]"
          style={d(1300)}
        >
          · · · ещё пара уточнений · · ·
        </p>
        <div>
          <Bubble from="bot" delay={1600}>
            {offerText}
          </Bubble>
          <BotButtons labels={OFFER.buttons?.slice(0, 2) ?? []} delay={1850} />
        </div>
        <div className="hc-in mt-auto flex justify-end pt-2" style={d(2300)}>
          <span className="hc-typing flex gap-1 rounded-2xl rounded-br-md bg-[rgb(62_230_163/0.14)] px-3 py-2.5">
            <span className="size-1 rounded-full bg-[var(--hc-bright)]" />
            <span className="size-1 rounded-full bg-[var(--hc-bright)]" />
            <span className="size-1 rounded-full bg-[var(--hc-bright)]" />
          </span>
        </div>
      </div>
      <div className="text-muted mt-3 flex items-center justify-between rounded-xl border border-[color:var(--hc-line)] px-3 py-2 text-[0.62rem]">
        Напишите сообщение…
        <Icon
          name="arrow-right"
          size={12}
          className="text-[color:var(--hc-bright)]"
        />
      </div>
    </div>
  );
}

function CoreCard({ className }: { className?: string }) {
  const steps: { icon: IconName; label: string }[] = [
    { icon: "chat", label: "Сообщение пациента" },
    { icon: "shield", label: "Проверка тревожных признаков" },
    { icon: "book", label: "Ответ по справочнику клиники" },
    { icon: "target", label: "Подбор направления" },
    { icon: "calendar", label: "Запись по расписанию" },
  ];
  return (
    <div
      className={cn(
        "hc-card relative flex flex-col overflow-hidden p-4",
        className,
      )}
    >
      <CardTitle icon="sparkle">Маршрут обращения</CardTitle>
      {/* Светящееся ядро ИИ с вращающимися кольцами. */}
      <div className="relative mx-auto mt-1 grid size-32 place-items-center">
        <div className="hc-core absolute inset-0 rounded-full" />
        <div className="hc-ring hc-spin absolute inset-2 border-dashed" />
        <div className="hc-ring hc-spin-rev absolute inset-6">
          <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-[var(--hc-bright)] shadow-[0_0_12px_2px_rgb(62_230_163/0.7)]" />
        </div>
        <div className="hc-ring absolute inset-10 bg-[rgb(5_11_9/0.6)]" />
        <span className="relative text-center text-[0.68rem] leading-tight font-semibold">
          ИИ-
          <br />
          администратор
        </span>
      </div>
      <ol className="relative mt-2 space-y-1.5">
        <span className="absolute top-2 bottom-2 left-[0.8rem] w-px bg-[var(--hc-line-strong)]" />
        <span
          className="hc-travel absolute top-1 left-[0.66rem] size-1.5 rounded-full bg-[var(--hc-bright)] shadow-[0_0_10px_2px_rgb(62_230_163/0.8)]"
          style={{ "--hc-travel": "8.4rem" } as CSSProperties}
        />
        {steps.map((s, i) => (
          <li
            key={s.label}
            className="hc-in relative flex items-center gap-2.5"
            style={d(400 + i * 120)}
          >
            <span className="relative grid size-6.5 shrink-0 place-items-center rounded-full border border-[color:var(--hc-line-strong)] bg-[#07110d] text-[color:var(--hc-bright)]">
              <Icon name={s.icon} size={12} />
            </span>
            <span className="text-ink/90 text-[0.66rem]">{s.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function BookingCard() {
  return (
    <div className="hc-card hc-book p-4" style={d(2600)}>
      <CardTitle
        icon="check"
        aside={
          <span className="rounded-full bg-[rgb(62_230_163/0.14)] px-2 py-0.5 text-[0.6rem] font-semibold text-[color:var(--hc-bright)]">
            Подтверждена
          </span>
        }
      >
        Запись на приём
      </CardTitle>
      <div className="mt-3 flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[rgb(62_230_163/0.14)] text-[0.68rem] font-semibold text-[color:var(--hc-bright)]">
          ИМ
        </span>
        <div className="min-w-0">
          <p className="text-[0.75rem] font-semibold">Игорь Макетов</p>
          <p className="text-muted text-[0.62rem]">Травматолог-ортопед</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between rounded-xl bg-[rgb(240_247_242/0.04)] px-3 py-2 text-[0.68rem]">
        <span className="flex items-center gap-1.5">
          <Icon name="calendar" size={12} className="text-muted" />
          пн, 26 окт · 14:00
        </span>
        <span className="text-muted">Бот ВКонтакте</span>
      </div>
    </div>
  );
}

function ScheduleCard() {
  const slots = [
    "12:00",
    "12:30",
    "13:00",
    "13:30",
    "14:00",
    "14:30",
    "15:00",
    "15:30",
  ];
  const busy = new Set(["12:30", "13:30"]);
  return (
    <div className="hc-card p-4">
      <CardTitle
        icon="clock"
        aside={<span className="text-muted text-[0.62rem]">пн, 26 окт</span>}
      >
        Расписание врача
      </CardTitle>
      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {slots.map((t) => (
          <span
            key={t}
            className={cn(
              "relative rounded-lg py-1.5 text-center text-[0.64rem] tabular-nums",
              busy.has(t)
                ? "text-muted bg-[rgb(240_247_242/0.04)] line-through decoration-[rgb(240_247_242/0.3)]"
                : "text-ink/90 border border-[color:var(--hc-line)]",
            )}
          >
            {t}
            {t === "14:00" && (
              <span
                className="hc-book absolute inset-0 grid place-items-center rounded-lg bg-[var(--hc-bright)] font-semibold text-[#03140d] shadow-[0_0_18px_-2px_rgb(62_230_163/0.7)]"
                style={d(2700)}
              >
                14:00
              </span>
            )}
          </span>
        ))}
      </div>
      <p className="text-muted mt-2.5 text-[0.6rem]">
        Записывает только на свободное время
      </p>
    </div>
  );
}

function TodayCard({ className }: { className?: string }) {
  const rows = [
    ["18:30", "Павел Примеров", "Терапевт", "Бот ВКонтакте"],
    ["18:30", "Елена Образцова", "ЛОР", "Администратор"],
    ["19:00", "Анна Тестова", "Терапевт", "VK Mini App"],
  ] as const;
  return (
    <div className={cn("hc-card p-4", className)}>
      <CardTitle
        icon="calendar"
        aside={
          <span className="text-muted text-[0.62rem]">
            все каналы — в одном списке
          </span>
        }
      >
        Записи на сегодня
      </CardTitle>
      <ul className="mt-2.5 divide-y divide-[color:var(--hc-line)]">
        {rows.map(([time, name, spec, source], i) => (
          <li
            key={name}
            className="hc-in grid grid-cols-[3rem_1fr_auto_auto] items-center gap-3 py-2 text-[0.68rem]"
            style={d(900 + i * 150)}
          >
            <span className="font-semibold tabular-nums">{time}</span>
            <span className="min-w-0 truncate">
              {name}
              <span className="text-muted"> · {spec}</span>
            </span>
            <span className="text-muted rounded-full border border-[color:var(--hc-line)] px-2 py-0.5 text-[0.6rem]">
              {source}
            </span>
            <span className="text-[0.6rem] font-medium text-[color:var(--hc-bright)]">
              Подтверждена
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RequestCard() {
  return (
    <div className="hc-card p-4">
      <CardTitle
        icon="users"
        aside={
          <span className="rounded-full bg-[rgb(227_207_148/0.14)] px-2 py-0.5 text-[0.6rem] font-semibold text-[color:var(--demo-ink)]">
            Новое
          </span>
        }
      >
        Обращение
      </CardTitle>
      <p className="mt-3 rounded-xl bg-[rgb(240_247_242/0.04)] px-3 py-2 text-[0.68rem] leading-snug">
        «Хочу перенести запись на пятницу после 16:00»
      </p>
      <p className="text-muted mt-2 flex items-center gap-1.5 text-[0.6rem]">
        <Icon
          name="check"
          size={11}
          className="text-[color:var(--hc-bright)]"
        />
        Передано с разрешения пациента
      </p>
    </div>
  );
}

function Chip({
  icon,
  children,
  style,
}: {
  icon: IconName;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <span
      className="hc-chip text-ink flex items-center gap-2.5 py-2 pr-4 pl-2 text-[0.75rem] font-medium whitespace-nowrap"
      style={style}
    >
      <span className="grid size-7 place-items-center rounded-full bg-[rgb(62_230_163/0.14)] text-[color:var(--hc-bright)]">
        <Icon name={icon} size={14} />
      </span>
      {children}
    </span>
  );
}

/* ——— Узкий экран: компактная композиция без наклона ——— */

function MobileConsole() {
  return (
    <div aria-hidden="true" className="relative lg:hidden">
      <div className="hc-console relative mr-8 overflow-hidden p-3.5 sm:mr-24">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-[0.75rem] font-semibold">
            <span className="grid size-7 place-items-center rounded-lg bg-[rgb(62_230_163/0.12)] text-[color:var(--hc-bright)]">
              <Icon name="sparkle" size={14} />
            </span>
            Демо-Мед
          </span>
          <span className="hc-chip flex items-center gap-1.5 px-2.5 py-1 text-[0.62rem]">
            <span className="hc-pulse size-1.5 rounded-full bg-[var(--hc-bright)]" />
            Бот работает
          </span>
        </div>
        <ChatCard className="min-h-[19rem]" />
      </div>
      <div className="relative z-10 -mt-14 ml-auto w-[74%] max-w-[17rem] sm:mr-6">
        <BookingCard />
      </div>
      <div className="absolute -top-4 right-2 sm:right-10">
        <div className="hc-float">
          <span className="hc-chip text-ink flex items-center gap-2 px-3 py-1.5 text-[0.65rem] font-medium">
            <Icon
              name="shield"
              size={12}
              className="text-[color:var(--hc-bright)]"
            />
            При угрозе — 103 / 112
          </span>
        </div>
      </div>
    </div>
  );
}
