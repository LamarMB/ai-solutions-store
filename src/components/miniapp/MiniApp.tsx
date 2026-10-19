"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import {
  ApiError,
  looksLikeVkLaunch,
  useApi,
  type ClinicInfo,
  type MyBookings,
  type PatientBooking,
} from "@/components/miniapp/client";
import { BookingFlow, type FlowStart } from "@/components/miniapp/BookingFlow";
import {
  AboutScreen,
  DoctorsScreen,
  HomeScreen,
  MyBookingsScreen,
  ServicesScreen,
} from "@/components/miniapp/screens";
import { ErrorState, Spinner } from "@/components/miniapp/ui";
import { cn } from "@/lib/cn";

export type Tab = "home" | "doctors" | "bookings" | "services" | "about";

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "home", label: "Главная", icon: "home" },
  { id: "doctors", label: "Врачи", icon: "users" },
  { id: "bookings", label: "Записи", icon: "calendar" },
  { id: "services", label: "Услуги", icon: "document" },
  { id: "about", label: "О клинике", icon: "info" },
];

/**
 * Корень Mini App. Вне ВКонтакте (нет подписанных параметров запуска) —
 * только пояснение; данные пациента приходят лишь после проверки подписи на
 * сервере, поэтому подменить VK ID в адресе нельзя.
 */
export function MiniApp() {
  const [launch, setLaunch] = useState<"checking" | "vk" | "outside">(
    "checking",
  );

  useEffect(() => {
    const inVk = looksLikeVkLaunch();
    // Сообщаем клиенту ВКонтакте, что приложение готово (официальный VK Bridge).
    if (inVk)
      void import("@vkontakte/vk-bridge")
        .then(({ default: bridge }) => bridge.send("VKWebAppInit"))
        .catch(() => {});
    // Состояние запуска известно только в браузере.
    const id = window.setTimeout(() => setLaunch(inVk ? "vk" : "outside"), 0);
    return () => window.clearTimeout(id);
  }, []);

  if (launch === "checking")
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner label="Открываем приложение…" />
      </div>
    );
  if (launch === "outside") return <OutsideVk />;
  return <App />;
}

function OutsideVk() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <span className="bg-accent-soft text-accent flex size-14 items-center justify-center rounded-full">
        <Icon name="shield" size={28} />
      </span>
      <h1 className="text-h3 font-semibold">
        Откройте приложение во ВКонтакте
      </h1>
      <p className="text-muted">
        Запись к врачу «Демо-Мед» работает только внутри ВКонтакте: так
        приложение узнаёт, кто вы, и показывает только ваши записи.
      </p>
    </main>
  );
}

/** Экран поверх вкладок; «Назад» в браузере и на Android закрывает его. */
type Overlay = { kind: "flow"; start: FlowStart };

function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [overlay, setOverlay] = useState<Overlay>();
  const clinic = useApi<ClinicInfo>("clinic");
  const bookings = useApi<MyBookings>("bookings");

  useEffect(() => {
    const onPop = () => setOverlay(undefined);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const openFlow = useCallback((start: FlowStart = {}) => {
    window.history.pushState({ miniapp: "flow" }, "");
    setOverlay({ kind: "flow", start });
  }, []);
  const closeOverlay = useCallback(() => {
    if (window.history.state?.miniapp) window.history.back();
    else setOverlay(undefined);
  }, []);

  const goTo = useCallback((next: Tab) => {
    setTab(next);
    window.scrollTo({ top: 0 });
  }, []);

  const authError =
    clinic.error &&
    ["unauthorized", "expired", "not_allowed", "not_configured"].includes(
      clinic.error.code,
    )
      ? clinic.error
      : undefined;
  if (authError) return <AccessProblem error={authError} />;

  if (!clinic.data)
    return clinic.error ? (
      <main className="flex flex-1 items-center px-4">
        <ErrorState error={clinic.error} onRetry={clinic.reload} />
      </main>
    ) : (
      <div className="flex flex-1 items-center justify-center">
        <Spinner label="Загружаем расписание клиники…" />
      </div>
    );

  if (overlay?.kind === "flow")
    return (
      <BookingFlow
        clinic={clinic.data}
        start={overlay.start}
        onClose={closeOverlay}
        onDone={() => {
          bookings.reload();
          clinic.reload();
        }}
        onShowBookings={() => {
          closeOverlay();
          goTo("bookings");
        }}
      />
    );

  const props = {
    clinic: clinic.data,
    bookings,
    openFlow,
    goTo,
    reloadClinic: clinic.reload,
  };
  const screens: Record<Tab, ReactNode> = {
    home: <HomeScreen {...props} />,
    doctors: <DoctorsScreen {...props} />,
    bookings: <MyBookingsScreen {...props} />,
    services: <ServicesScreen {...props} />,
    about: <AboutScreen {...props} />,
  };

  return (
    <>
      <main
        key={tab}
        className="miniapp-screen mx-auto w-full max-w-xl flex-1 px-4 pt-4 pb-28"
      >
        {screens[tab]}
      </main>
      <nav
        aria-label="Разделы"
        className="border-border bg-surface fixed inset-x-0 bottom-0 z-20 border-t pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="mx-auto grid max-w-xl grid-cols-5">
          {TABS.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => goTo(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={cn(
                  "text-caption flex w-full flex-col items-center gap-1 pt-2.5 pb-2 font-medium transition-colors",
                  tab === t.id ? "text-accent" : "text-muted",
                )}
              >
                <Icon name={t.icon} size={22} />
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

function AccessProblem({ error }: { error: ApiError }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <span className="bg-surface-2 text-muted flex size-14 items-center justify-center rounded-full">
        <Icon name="shield" size={28} />
      </span>
      <h1 className="text-h3 font-semibold">
        {error.code === "not_allowed"
          ? "Доступ только для тестовых аккаунтов"
          : error.code === "not_configured"
            ? "Приложение ещё не настроено"
            : "Не удалось подтвердить вход"}
      </h1>
      <p className="text-muted">{error.message}</p>
    </main>
  );
}

export type ScreenProps = {
  clinic: ClinicInfo;
  bookings: {
    data?: MyBookings;
    error?: ApiError;
    loading: boolean;
    reload: () => void;
  };
  openFlow: (start?: FlowStart) => void;
  goTo: (tab: Tab) => void;
  reloadClinic: () => void;
};

export type { PatientBooking };
