import type { Metadata } from "next";
import { requirePage } from "@/admin/server";
import { Settings } from "@/components/admin/Settings";

export const metadata: Metadata = { title: "Настройки" };

export default async function SettingsPage() {
  await requirePage("settings.read");
  return <Settings />;
}
