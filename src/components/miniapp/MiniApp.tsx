"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ApiError,
  looksLikeVkLaunch,
  useApi,
  type ClinicInfo,
  type MyBookings,
  type PatientBooking,
} from "@/components/miniapp/client";
import { BookingFlow, type FlowStart } from "@/components/miniapp/BookingFlow";
import { DoctorProfile } from "@/components/miniapp/DoctorProfile";
import { MaIcon, type MaIconName } from "@/components/miniapp/icons";
import {
  AboutScreen,
  DoctorsScreen,
  HomeScreen,
  MyBookingsScreen,
  ServicesScreen,
} from "@/components/miniapp/screens";
import { ErrorState, Spinner } from "@/components/miniapp/ui";
import { cn } from "@/lib/cn";

export type Tab = "home" | "doctors" | "services" | "bookings" | "about";

const TABS: { id: Tab; label: string; icon: MaIconName }[] = [
  { id: "home", label: "Главная", icon: "home" },
  { id: "doctors", label: "Врачи", icon: "doctors" },
  { id: "services", label: "Услуги", icon: "services" },
  { id: "bookings", label: "Записи", icon: "calendar" },
  { id: "about", label: "Клиника", icon: "more" },
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
  if (launch === "outside")
    return (
      <Notice
        icon="shield"
        title="Откройте приложение во ВКонтакте"
        text="Запись к врачу «Демо-Мед» работает только внутри ВКонтакте: так приложение узнаёт, кто вы, и показывает только ваши записи."
      />
    );
  return <App />;
}

function Notice({
  icon,
  title,
  text,
}: {
  icon: MaIconName;
  title: string;
  text: string;
}) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <span className="bg-accent-soft text-accent flex size-16 items-center justify-center rounded-full">
        <MaIcon name={icon} size={30} />
      </span>
      <h1 className="font-display text-[1.5rem] leading-tight font-semibold">
        {title}
      </h1>
      <p className="text-muted">{text}</p>
    </main>
  );
}

/** Экраны поверх вкладок. «Назад» (кнопка, жест, Android) закрывает верхний. */
type Overlay =
  { kind: "flow"; start: FlowStart } | { kind: "doctor"; doctorId: string };

function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [stack, setStack] = useState<Overlay[]>([]);
  const clinic = useApi<ClinicInfo>("clinic");
  const bookings = useApi<MyBookings>("bookings");

  // Глубина стека хранится в истории браузера: «Назад» снимает верхний экран.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const depth = (e.state as { miniapp?: number } | null)?.miniapp ?? 0;
      setStack((s) => s.slice(0, depth));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const push = useCallback((overlay: Overlay) => {
    // Побочный эффект — вне функции обновления состояния (StrictMode вызывает её дважды).
    const depth = ((window.history.state?.miniapp as number) ?? 0) + 1;
    window.history.pushState({ miniapp: depth }, "");
    setStack((s) => [...s, overlay]);
    window.scrollTo({ top: 0 });
  }, []);
  const back = useCallback(() => {
    if (window.history.state?.miniapp) window.history.back();
    else setStack((s) => s.slice(0, -1));
  }, []);
  const closeAll = useCallback(() => {
    const depth = window.history.state?.miniapp ?? 0;
    if (depth > 0) window.history.go(-depth);
    else setStack([]);
  }, []);

  const goTo = useCallback((next: Tab) => {
    setTab(next);
    window.scrollTo({ top: 0 });
  }, []);
  const openFlow = useCallback(
    (start: FlowStart = {}) => push({ kind: "flow", start }),
    [push],
  );
  const openDoctor = useCallback(
    (doctorId: string) => push({ kind: "doctor", doctorId }),
    [push],
  );

  const authError =
    clinic.error &&
    ["unauthorized", "expired", "not_allowed", "not_configured"].includes(
      clinic.error.code,
    )
      ? clinic.error
      : undefined;
  if (authError)
    return (
      <Notice
        icon="shield"
        title={
          authError.code === "not_allowed"
            ? "Доступ только для тестовых аккаунтов"
            : authError.code === "not_configured"
              ? "Приложение ещё не настроено"
              : "Не удалось подтвердить вход"
        }
        text={authError.message}
      />
    );

  if (!clinic.data)
    return clinic.error ? (
      <main className="flex flex-1 items-center px-5">
        <ErrorState error={clinic.error} onRetry={clinic.reload} />
      </main>
    ) : (
      <div className="flex flex-1 items-center justify-center">
        <Spinner label="Загружаем расписание клиники…" />
      </div>
    );

  const top = stack.at(-1);
  if (top?.kind === "flow")
    return (
      <BookingFlow
        key={stack.length}
        clinic={clinic.data}
        start={top.start}
        onClose={back}
        onDone={() => {
          bookings.reload();
          clinic.reload();
        }}
        onShowBookings={() => {
          closeAll();
          goTo("bookings");
        }}
        onHome={() => {
          closeAll();
          goTo("home");
        }}
      />
    );
  if (top?.kind === "doctor") {
    const doctor = clinic.data.doctors.find((d) => d.id === top.doctorId);
    if (doctor)
      return (
        <DoctorProfile
          key={stack.length}
          clinic={clinic.data}
          doctor={doctor}
          onBack={back}
          onBook={(slot) => openFlow({ doctorId: doctor.id, ...slot })}
        />
      );
  }

  const props: ScreenProps = {
    clinic: clinic.data,
    bookings,
    openFlow,
    openDoctor,
    goTo,
    reloadClinic: clinic.reload,
  };
  const screens: Record<Tab, ReactNode> = {
    home: <HomeScreen {...props} />,
    doctors: <DoctorsScreen {...props} />,
    services: <ServicesScreen {...props} />,
    bookings: <MyBookingsScreen {...props} />,
    about: <AboutScreen {...props} />,
  };

  return (
    <>
      <main
        key={tab}
        className="miniapp-screen mx-auto w-full max-w-xl flex-1 px-5 pt-[calc(1.25rem+env(safe-area-inset-top))] pb-[calc(6.5rem+env(safe-area-inset-bottom))]"
      >
        {screens[tab]}
      </main>
      <nav
        aria-label="Разделы"
        className="ma-bottom-nav bg-surface shadow-raised fixed inset-x-0 bottom-0 z-20 rounded-t-[22px] pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="mx-auto grid max-w-xl grid-cols-5 px-1">
          {TABS.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => goTo(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={cn(
                  "text-caption flex w-full flex-col items-center gap-1 pt-3 pb-2.5 font-medium transition-colors",
                  tab === t.id ? "text-accent" : "text-muted",
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                    tab === t.id ? "bg-accent-soft" : "",
                  )}
                >
                  <MaIcon name={t.icon} size={22} />
                </span>
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </>
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
  openDoctor: (doctorId: string) => void;
  goTo: (tab: Tab) => void;
  reloadClinic: () => void;
};

export type { PatientBooking };
