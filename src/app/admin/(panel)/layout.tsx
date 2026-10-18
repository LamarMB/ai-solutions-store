import { redirect } from "next/navigation";
import { currentAdmin } from "@/admin/server";
import { AdminShell } from "@/components/admin/AdminShell";

/** Все страницы панели — только после входа (проверка сессии на сервере). */
export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: LayoutProps<"/admin">) {
  const admin = await currentAdmin();
  if (!admin) redirect("/admin/login");
  return <AdminShell login={admin.login}>{children}</AdminShell>;
}
