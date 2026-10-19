import { MiniApp } from "@/components/miniapp/MiniApp";

/**
 * Точка входа VK Mini App. Страница статична: данные пациента приходят только
 * из API после проверки подписи параметров запуска.
 */
export default function MiniAppPage() {
  return (
    <div className="theme-miniapp flex min-h-dvh flex-col">
      <MiniApp />
    </div>
  );
}
